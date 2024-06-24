'use strict';
const SDKError = require('./error/SDKError');
const { SERVICES } = require('./Const');

// converts participantsPId (v2) to participants (v3)
function createParticipantsList(conversationDetails, change, agent) {

    if (!conversationDetails.hasOwnProperty('participantsPId')) {
        throw new SDKError(`participantsPId key property is missing on notification for convId ${change.result.convId}`, null, SERVICES.MESSAGING);
    }

    // 1. identify in/out
    let participants = [];
    let participantsPId = conversationDetails.participantsPId;

    // 2. create the initial global roles in participants, based on PIds
    Object.keys(participantsPId).forEach(role => {
        // each PId in this role will get an entry in participants
        participantsPId[role].forEach(id => participants.push({id: id, role: role}));
    });

    // 3. look at each participant in each dialog, try to overwrite its id from the global list
    conversationDetails.dialogs.forEach(dialog => {

        // only handle channelType messaging
        if (dialog.channelType) {
            switch (dialog.channelType) {
                case 'MESSAGING': break; // messaging is OK
                case 'COBROWSE': return; // ignore cobrowse dialogs
                default:
                    agent.emit('warn', {message:`Unknown channelType: ${dialog.channelType}`});
                    // continue for now todo review warn logs from VA and add to this list
            }
        }

        // OLD dialogs don't have participantsDetails, lets ignore them and any others that dont have this
        if (!dialog.participantsDetails) {
            agent.emit('warn', {message:`Invalid dialog information, participantsDetails is missing ${JSON.stringify(dialog)}`});
            return;
        }

        let roleCount = {};
        dialog.participantsDetails.forEach(dialogParticipant => {

            let role = dialogParticipant.role;

            // ensure we've got a count for this dialogParticipant's role
            // then get the current count for an index
            // then increment the count
            if (!roleCount.hasOwnProperty(role)) roleCount[role] = 0;
            let pidIndex = roleCount[role];
            roleCount[role]++;

            // if the global PId list doesn't have this role
            if (!participantsPId.hasOwnProperty(role)) {
                // Suggested agents don't show up in the global participants list for some reason
                if (dialogParticipant.state === 'SUGGESTED') {
                    return;
                }
                let message = `invalid participant on conversation ${change.result.convId} - ${JSON.stringify(dialogParticipant)}`;
                // console.warn(message);
                agent.emit('warn', {message});

                return; // ignore for now
            }

            // get the global PIds for this role
            let rolePIds = participantsPId[role];

            // in case in the dialog there more participants than in the conversation
            if (pidIndex < rolePIds.length) {
                dialogParticipant.id = rolePIds[pidIndex];
            }

        });
    });

    return participants;
}

module.exports = {
    '.ams.aam.ExConversationChangeNotification': (msg, agent) => {
        msg.type = 'cqm.ExConversationChangeNotification';
        msg.body.changes.forEach(change => {
            if (change && change.result) {
                delete change.result.lastUpdateTime;
                delete change.result.numberOfunreadMessages;

                let conversationDetails = change.result.conversationDetails;
                delete conversationDetails.convId;
                delete conversationDetails.note;
                delete conversationDetails.groupId;
                delete conversationDetails.csatRate;

                // find __myRole, if Agent.__oldAgentId === the id
                Object.keys(conversationDetails.participants).forEach(role => {
                    let isMyRole = conversationDetails.participants[role].filter(id => id === agent.__oldAgentId).length > 0;
                    if (isMyRole) conversationDetails.__myRole = role;
                });
                conversationDetails.getMyRole = () => conversationDetails.__myRole; // getMyRole is deprecated. Please use sdk.agentId

                // convert participantsPId (v2) to participants (v3), removing participantsPId after
                conversationDetails.participants = createParticipantsList(conversationDetails, change, agent);
                delete conversationDetails.participantsPId;
            }
        });

        return msg;
    },
    '.ams.routing.SetAgentState': (msg, agent) => {
        msg.body.channels = ['MESSAGING'];
        msg.body.agentUserId = agent.__oldAgentId;
        return msg;
    },
    '.ams.cm.UpdateConversationField': (msg, agent) => {
        msg.body.conversationField.forEach(f => {
            if (f.field === 'ParticipantsChange' && !f.userId) {
                f.userId = agent.__oldAgentId;
            }
        });
        return msg;
    },
    '.ams.routing.SubscribeRoutingTasks': (msg, agent) => {
        msg.body.channelType = 'MESSAGING';
        msg.body.agentId = agent.__oldAgentId;
        msg.body.brandId = agent.accountId;
        return msg;
    },
    '.ams.routing.RingUpdated': (msg) => {
        msg.type = 'deprecated';
        delete msg.body; // deprecated notification
        return msg;
    },
    '.ams.aam.SubscribeExConversations': (msg, agent) => {
        msg.body.agentIds = msg.body.agentIds ? msg.body.agentIds
            .map(id => id === agent.agentId ? agent.__oldAgentId : id) : undefined;
        return msg;
    },
    '.ams.routing.RoutingTaskNotification': (msg) => {
        msg.body.changes.forEach(c => {
            delete c.result.routingTaskId;
            delete c.result.assignedAgentId;
            delete c.result.brandId;
            c.result.ringsDetails.forEach(rd => {
                delete rd.brandId;
                delete rd.convId;
                delete rd.consumerId;
                delete rd.skillId;
            });
        });
        msg.type = 'routing.RoutingTaskNotification';
        return msg;
    },
    '.ams.userprofile.GetUserProfile$Response': (msg) => {
        let SDEs = [];

        let authData = msg.body.authenticatedData;
        let privateData = msg.body.privateData || {};
        let claims = msg.body.claims || {};
        if (claims && claims.lp_sdes) {
            if (typeof claims.lp_sdes === 'string') {
                SDEs.push({type: 'other', info: claims.lp_sdes})
            } else {
                claims.lp_sdes.forEach(sde => {
                    sde.acr = msg.body.acr;
                    sde.iss = claims.iss;
                    SDEs.push(sde);
                });
            }
        }
        if (authData && authData.lp_sdes) {
            if (typeof authData.lp_sdes === 'string') {
                SDEs.push({type: 'other', info: authData.lp_sdes})
            } else {
                authData.lp_sdes.forEach(sde => {
                    sde.auth = {};
                    SDEs.push(sde);
                });
            }
        }
        if (privateData.mobileNum) {
            ctmrinfo.info.imei = privateData.mobileNum;
        }
        if (privateData.userId) {
            ctmrinfo.info.customerId = privateData.userId;
        }
        if (Object.keys(ctmrinfo.info).length > 0) {
            SDEs.push(ctmrinfo);
        }

        let personalInfo = {
            type: 'personal',
            personal: {}
        };
        if (msg.body.firstName) {
            personalInfo.personal.firstname = msg.body.firstName;
        }
        if (msg.body.lastName) {
            personalInfo.personal.lastname = msg.body.lastName;
        }
        if (privateData.email || privateData.mobileNum) {
            personalInfo.personal.contacts = [{
                email: privateData.email,
                phone: privateData.mobileNum
            }];
        }
        if (Object.keys(personalInfo.personal).length > 0) {
            SDEs.push(personalInfo);
        }

        delete msg.body;
        msg.body = SDEs;
        return msg;
    },
    'ms.SubscribeMessagingEvents': (msg) => {
        // TODO: recored subscribed conversations.
        // agent.subscribed = agent.subscribed || {};
        // agent.subscribed[msg.body.dialogId] = true;
        msg.type = '.ams.ms.QueryMessages';
        msg.body.newerThanSequence = msg.body.fromSeq || 0;
        return msg;
    },
    '.ams.ms.QueryMessages$Response': (msg, agent) => {
        if (msg.body.length > 0) {
            const dialogId = msg.body[0].dialogId;
            msg.body.forEach(c => {
                c.__isMe = c.originatorId === agent.__oldAgentId;
                // isMe is deprecated. Please use sdk.agentId
                c.isMe = () => c.__isMe;
                c.originatorId = c.originatorPId;
                delete c.originatorPId;
            });
            agent._handleNotification({
                kind: 'notification',
                type: 'ms.MessagingEventNotification',
                body: {dialogId: dialogId, changes: msg.body}
            });
        }
        delete msg.body;
        msg.type = 'GenericSubscribeResponse';
        return msg;
    },
    '.ams.ms.OnlineEventDistribution': (msg, agent) => {
        // TODO: filter non subscribed notifications.
        msg.type = 'ms.MessagingEventNotification';
        msg.body.__isMe = msg.body.originatorId === agent.__oldAgentId;
        msg.body.originatorId = msg.body.originatorPId;
        delete msg.body.originatorPId;
        msg.body = {dialogId: msg.body.dialogId, changes: [msg.body]};
        const c = msg.body.changes[0];
        c.isMe = () => c.__isMe;
        return msg;
    },
    '.ams.cm.AgentRequestConversation': (msg) => {
        msg.body.channelType = 'MESSAGING';
        return msg;
    },
    '.ams.routing.SubscribeAgentsState': (msg, agent) => {
        msg.body.brandId = agent.accountId;
        msg.body.agentId = agent.__oldAgentId;
        return msg;
    },
    '.ams.routing.AgentStateNotification': (msg) => {
        msg.type = 'routing.AgentStateNotification';
        msg.body.changes.forEach(c => {
            delete c.result.agentUserId; // remove old id. Still don't have new uuid.
        });
        return msg;
    }
};
