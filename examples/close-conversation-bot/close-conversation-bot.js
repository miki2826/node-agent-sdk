'use strict';

/*
 * This demo try to use most of the API calls of the messaging agent api. It:
 *
 * 1) Registers the agent as online
 * 2) Accepts any routing task (== ring)
 * 3) Publishes to the conversation the consumer info when it gets new conversation
 * 4) Gets the content of the conversation
 * 5) Emit 'CloseConversationBot.ContentEvent' to let the developer handle contentEvent responses
 * 6) Mark as 'read' the handled messages
 *
 */

const Agent = require('./../../lib/AgentSDK');


class CloseConversationBot extends Agent {

    constructor(conf) {
        super(conf);

        this.conf = conf;

        this.CONTENT_NOTIFICATION_LEGACY = 'CloseConversationBot.ContentEvnet'; // deprecated, some old bots might still use this, but example code will not reference this
        this.CONTENT_NOTIFICATION = 'CloseConversationBot.ContentEvent';
        this.NEW_CONVERSATION = 'CloseConversationBot.NewConversation';

        this.openConvs = {};

        this.on('connected', this.onConnected.bind(this));

        // handle conversation state change notifications
        this.on('cqm.ExConversationChangeNotification', this.onConversationNotification.bind(this));

        this.on('error', err => console.log('got an error', err));

        this.on('closed', data => {
            // For production environments ensure that you implement reconnect logic according to
            // liveperson's retry policy guidelines: https://developers.liveperson.com/guides-retry-policy.html
            console.log('socket closed', data);

            // stop keep alive
            clearInterval(this._pingClock);

            // mark all convs as offline
            Object.keys(this.openConvs).forEach(key => {
                this.openConvs[key].state = 'offline';
            });

            // then reconnect
            this.reconnectWithMessages();
        });
    }

    onConnected(msg) {
        console.log('connected...', this.conf.id || '', msg);

        // subscribe to all conversations
        this.subscribeExConversations({
            'convState': ['OPEN']
        }, (e, resp) => console.log('subscribeExConversations', this.conf.id || '', resp || e));

        // start the keep alive process
        this._pingClock = setInterval(this.getClock, 30000);
    }

    reconnectWithMessages() {
        console.log('reconnecting');
        this.reconnect(); // regenerate token for reasons of authorization (data === 4401 || data === 4407)
    }

    onConversationNotification(notificationBody) {
        notificationBody.changes.forEach(change => {

            if (change.type === 'UPSERT') {

                // a new conversation
                if (!this.openConvs[change.result.convId]) {
                    this.onNewConversation(change);
                }

                // an existing conversation
                else {

                    // look up the conversation state
                    let conversation = this.openConvs[change.result.convId];

                    // this is the first time we've seen this since reconnect
                    if (conversation.state === 'offline') {
                        conversation.state = 'active';
                        console.log('conversation resumed after being online');
                    }
                }
                this.onCloseConversation(change);
            }

            else if (change.type === 'DELETE') {
                this.onCloseConversation(change);
            }

        });
    }

    onNewConversation(change) {
        // create a conversation state object
        let conversation = {
            messages: {},
            consumerId: null,
            state: 'active'
        };

        // add it to our list of known conversations
        this.openConvs[change.result.convId] = conversation;
    }

    onCloseConversation(change) {
        setTimeout(() => {

            if (this.openConvs.hasOwnProperty(change.result.convId)) {
                // conversation was closed or transferred
                delete this.openConvs[change.result.convId];
            }

        }, 1000);
    }
}

module.exports = CloseConversationBot;
