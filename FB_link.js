
'use strict';   //runs strict js subset
const FB_SECRET_TOKEN = ''  //define fb secret token value
const FB_PAGE_ACCESS_TOKEN = ''
const REST_PORT = (process.env.PORT || X);   //app listen on port X

const apiai = require('apiai');
const uuid = require('node-uuid');
const async = require('async');

const APIAI_ACCESS_TOKEN = '45e9a775b5254097abcc7848528d7d4a'
const apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: 'en', requestSource: "fb"});
const sessionIds_db = new Map();    //Create user session database


var express = require('express'); //express handles routes
var request = require('request');
var bodyParser = require('body-parser');  //helps parse strings
var JSONbig = require('json-bigint'); //helps parse json


//Function completes facebook verification process
//Called from main
function FB_verificationHandler(req,res) {  //req is the request field of the HTTP get action, res is the result that is sent back as the HTTP response
  console.log("FB_verificationHandler:: Validating FB webhook link");  //log
  if(req.query['hub.verify_token'] == FB_SECRET_TOKEN) { //pulls out verify_token from req query which is the secret id specified in fb dev webhook parameters
    console.log("FB_verificationHandler:: Validation success :D")
    res.status(200).send(req.query['hub.challenge']); //if secret token matches then respond with challenge answer to vailidate (HTTP status 200 = OK)
    
    setTimeout(function () {  //set timer to 3000ms = 3sec then do subscribe function
      FB_subscribeRequest();
    }, 3000);
  } else {
    console.log("FB_verificationHandler:: Validation fail! Wrong secret token.")
    res.status(403).send('Error, wrong validation token!'); //HTTP 403 = Forbidden
  }
};


//Function forces completion of FB messenger subscription to initial HTTP get source if not already subscribed
//Called from FB_verificationHandler
function FB_subscribeRequest() {
  console.log('FB_subscribeRequest:: FB_subscribeRequest attempt')
  request({
    method: 'POST',
    uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + FB_PAGE_ACCESS_TOKEN
  },
  (error, response, body) => {
    if (error) {
      console.log('FB_subscribeRequest:: Error while completion subscription: ', error);
    } else {
      console.log('FB_subscribeRequest:: Successful subscription. Result: ', response.body);
    }
  });
};


//Function extracts out FB messages sent to the bot and sends them off to be processed for response
//FB messages can be batched as multiple events within multiple entries
//These individual events need to be extracted before being read and processed for response
//Called from main
function FB_messagePOST(req,res){
    console.log("FB_messagePOST:: POST request received")
    try {
        var data = JSONbig.parse(req.body); //parse input messages data
        //console.log("POST request data: ", data)
        if (data.entry) {
          let entries = data.entry; //number of batched entries
          //console.log("Entries: ",entries)
          //sort through batched entries to extract each messenger entry
          entries.forEach(function(entry_x) {  //loop through entry array
            //console.log("Extracted entry: ", entry_x)
            let messaging_events = entry_x.messaging; //number of batched events
            if (messaging_events) {
                messaging_events.forEach(function(event_y) { //loop through event array
                    //console.log("Extracted event: ", event_y)
                    if (event_y.message && !event_y.message.is_echo) {  //check if event is a message and it's not an echo
                        console.log("FB_messagePOST:: Message input event is going to be processed")
                        FB_receivedMessage(event_y);  //input message received, now process response message
                    } else {
                        console.log("FB_messagePOST:: FB message type not valid?")
                        console.log('FB_messagePOST:: Event is:\n', event_y)
                    }   //if fb event isn't a message event that requires action
                });
            }
          });
        }

        console.log("FB_messagePOST:: POST went well. Send HTTP 200")
        return res.status(200).json({ //no received message event to act on so just respond with empty ok
          status: "ok"
        });
    } catch (err) { //catch if something goes wrong in parsing message events or forming response
        console.log("FB_messagePOST:: error in forming POST response D:")
        return res.status(400).json({
          status: "error in forming POST response",
          error: err
        });
    }
};



//Process and action received input facebook message event
//Called from FB_messagePOST-entry
function FB_receivedMessage(event) {
    console.log('FB_receivedMessage:: FB input message: ',event)
    if (event.message.text) {
        var text = event.message.text;
        var sender = event.sender.id.toString();
        var payload = 'No payload';
        if (isDefined(event.message.quick_reply)) {
            payload = event.message.quick_reply.payload;
        };
        console.log('FB_receivedMessage:: Sender ID: ',sender)
        console.log('FB_receivedMessage:: Quick reply payload: ',payload)
        sessionMgmt(sender,text,payload);
    }
};

//check why a uuid is actually required. Not convinced here.
function sessionMgmt(sender,text,payload) {

    if (!sessionIds_db.has(sender)) { //check if the sender ID exists in the UUID table (Universal unique identifier)
        //if senderID doesn't exist then add it with user info as JSON object
        //this is fully global because the db map object is global
        FB_getUserInfo(sender)  //get user info as a JSON object
        .then((userInfo) => {
            var userInfo_json = JSON.parse(userInfo);   //parse JSON object
            console.log("sessionMgmt:: first_name = " + userInfo_json.first_name + " -- last_name = " + userInfo_json.last_name + " -- locale = " + userInfo_json.locale + " -- timezone = " + userInfo_json.timezone + " -- gender = " + userInfo_json.gender);
            userInfo_json.UUID = uuid.v1(); //add unique UUID
            //v1 UUID is time based generated. The random UUID is only guaranteed to stay constant for the lifetime of the current JS runtime.
            var userInfo_with_UUID = JSON.stringify(userInfo_json); //put it back to JSON object
            sessionIds_db.set(sender, userInfo_with_UUID);  //create new entry of sender and new UUID. Sender is the table key.
            
            console.log('sessionMgmt:: SenderID: ',sender)
            console.log('sessionMgmt:: New ID row created: ',sessionIds_db.get(sender))    //print ID string

            FB_processInputEvent(sender,text,payload,0);

        }).catch(err=> {
            console.log('sessionMgmt:: error_when_trying_to_get_FB_userInfo');
        });
    } else {
        console.log('User already known')
        FB_processInputEvent(sender,text,payload,0);
    }
};


//Process FB event input data (common to message and postback events)
//Called from FB_receivedMessage
function FB_processInputEvent(sender,text,payload,retrycount){
    console.log('FB_processInputEvent:: Process FB Event')
    if (retrycount < 5) {   //5 retries @ 3 secs each = about 15 secs (max wait time)
        if (sessionIds_db.get(sender)) {    //check if userinfo data set yet. If not then fail and wait for repeat
            //this is not ideal and should be fixed later
            console.log('User info is ready')
            var apiaiRequest = apiAI_prep(sender,text);  //send request message to apiai service
            apiAI_chat(apiaiRequest)       //handle apiai service response
            .then(responsedata => {
                var responseText = responsedata[0];
                var responseAction = responsedata[1];
                console.log('Response Text: ',responseText)
                console.log('Response Action: ',responseAction)
                var iserror = responseText.substring(0,6);  //get start of apiAI response string and check if it starts with 'XError'
                if (iserror == 'XError') {    //if it starts with XError then it means the webhook server didn't respond in time (prob still starting up)
                    var xerr = responseText.substring(7);   //extract which action failed to respond
                    console.log('XERROR occurred. apiAI did not return reponse in time for action: ',xerr)  //log
                    //then wait a bit for webhook server to spin up and retry
                    setTimeout( function() {
                        retrycount = retrycount + 1; //increment retrycount
                        console.log('Waited 3sec now retry. Retry count: ',retrycount)
                        FB_processInputEvent(sender,text,payload,retrycount);  //retry
                        return
                    },3000) //wait 3 sec
                    return
                };

                FB_build_quick_reply(responseText,responseAction,payload)
                .then(quick_reply_data => {
                    console.log('Process data from quick reply build')
                    var text = quick_reply_data[0];
                    var quick_reply = quick_reply_data[1];
                    var qr_send_payload = quick_reply_data[2];
                    console.log('Text is: ',text)
                    console.log('Quick reply is: ',quick_reply)
                    if (isDefined(quick_reply)) {
                        FB_sendTextMessage_quickreply(sender,text,quick_reply,qr_send_payload);
                        return
                    };
                    FB_sendTextMessage(sender,text);
                    return

                }).catch(quick_reply_data => {
                    console.log('FB_processInputEvent:: No quick reply needed')
                    var responseText = quick_reply_data[1];
                    console.log('Response text finalised: ',responseText)

                    //FB API limit for text length is 320 chars so must split if needed
                    if (responseText.length >320) {
                        console.log('FB_processInputEvent:: ResponseText is over 320 chars long. Length is = ',responseText.length)
                        var splitText = chunkString(responseText, 300);
                        console.log('FB_processInputEvent:: ResponseText split: ',splitText);
                        //async.eachSeries iterates through all of the splitText entries
                        //it then performs the sendFBMessage function for each chunkReponse piece
                        async.eachSeries(splitText, (textPart, callback) => {
                            sendFBMessage(sender, {text: textPart}, callback);  //not sure how the callback works here. Investigate
                            return
                        });
                    }
                    //if not more than 320 chars then just send text
                    FB_sendTextMessage(sender, responseText);
                });

            }).catch(err => {
                    console.log('FB_processInputEvent:: error_from_fb_ProcessInputEvent');
            });
        } else {
            console.log('UserInfo not yet set')
            //setTimeout(function () {
            //    FB_processInputEvent(sender,text);
            //},500)
        }
    } else {
        console.log('Give up after too many retries. apiAI webhook is not responding. Retries: ',retrycount)
        var errmsg = "Sorry we couldn't get the info you asked for. Please try again.\nIf you see this message again we may be down at the moment but we'll be back up soon.\nSorry about that."
        FB_sendTextMessage(sender, errmsg);
    }

};


//Generates quick reply data for message response
function FB_build_quick_reply(responseText, responseAction,payload) {
    return new Promise(function (resolve, reject) {
        console.log('FB_build_quick_reply:: Buildling FB quick reply')

        if (responseAction == 'input.unknown') {
            console.log('Unknown input message')
            responseText = responseText + "\n\nLet's start by checking your current watchlist status."
            console.log('responseText is: ',responseText)
            var quick_reply = 'Show me my watchlist'
            var qr_send_payload = 'Unknown request'
            console.log('Quick reply set: ',quick_reply)
            var responsedata = [responseText, quick_reply, qr_send_payload]
            resolve(responsedata)
            return
        } else if (responseAction == 'smalltalk.greetings') {
            console.log('FB_build_quick_reply:: Greeting with empty watchlist. Set quick reply.')
            responseText = responseText + "\n\nI can tell you the current price of any stock on the Australian Stock Exchange (ASX).\n\nClick the button to try!"
            var quick_reply = 'Current CBA price?'
            var qr_send_payload = '1st price request'
            var responsedata = [responseText, quick_reply, qr_send_payload]
            resolve(responsedata);
            return
        } else if (payload == '1st price request') {
            console.log('FB_build_quick_reply:: Greeting with empty watchlist. Set quick reply.')
            responseText = responseText + "\n\nGreat! I can also tell you about the price of your favourite stocks saved to your watchlist.\n\nClick the button to try!"
            var quick_reply = 'Show me my watchlist'
            var qr_send_payload = '1st watchlist'
            var responsedata = [responseText, quick_reply, qr_send_payload]
            resolve(responsedata);
            return
        } else if (responseAction == 'watchlist' && (responseText.substring(0,31) == 'Uh oh! Your watchlist is empty.' || responseText.substring(0,45) == 'Uh oh! You haven\'t set up your watchlist yet.')) {
            console.log('FB_build_quick_reply:: Empty watchlist. Set quick reply.')
            responseText = responseText + "\n\nClick the button to add CBA (Commonwealth Bank of Australia) to your watchlist."
            var quick_reply = 'Add CBA to watchlist'
            var qr_send_payload = 'Add 1st stock'
            var responsedata = [responseText, quick_reply, qr_send_payload]
            resolve(responsedata);
            return
        } else if (payload == 'Add 1st stock') {
            console.log('FB_build_quick_reply:: Add 1st stock')
            responseText = responseText + "\n\nGreat! Now click the button to see your watchlist."
            var quick_reply = 'Show me my watchlist'
            var qr_send_payload = '1st stock added'
            var responsedata = [responseText, quick_reply, qr_send_payload]
            resolve(responsedata);
            return
        } else if (payload == '1st stock added') {
            console.log('FB_build_quick_reply:: 1st stock added')
            responseText = responseText + "\n\nYou can add another stock to your watchlist by typing 'Add X to my watchlist' where X is the company code (e.g. BHP). Or click the button below."
            var quick_reply = 'Add BHP to watchlist'
            var qr_send_payload = 'Add 2nd stock'
            var responsedata = [responseText, quick_reply, qr_send_payload]
            resolve(responsedata);
            return
        } else if (payload == 'Add 2nd stock') {
            console.log('FB_build_quick_reply:: Add 2nd stock')
            responseText = responseText + "\n\nGreat. You can also remove a stock by typing 'Remove X from my watchlist' where X is the company code.\n\nNow type 'Show me my watchlist' to see your updated watchlist."
            var responsedata = [responseText]
            resolve(responsedata);
            return
        };
        
        console.log('FB_build_quick_reply:: FB quick reply not set')
        var responsedata = ['no quick reply', responseText]
        reject(responsedata);
    });
};

//Sends FB message to APIai service as input
//Called from FB_processInputEvent
function apiAI_prep(sender,text) {
    console.log('apiAI_prep:: Sending request to APIai service')

    var userInfo = JSON.parse(sessionIds_db.get(sender));
    var apiaiRequest = apiAiService.textRequest(text,   //send to APIai service the text plus new defined params
    {                                                   //the new defined params can be interacted with in API.ai as #param name e.g. facebook_first_name
        sessionId: sender,  //userInfo.UUID,   //get UUID to send to APIai. APIai doesn't need the FB sender ID
        contexts: [
            {
                name: "generic",    //add new params to apiai for using in speech output
                parameters: {
                    fb_userid: sender,
                    fb_firstname: userInfo.first_name,   //gotta be used in apiai as the name here
                    fb_lastname: userInfo.last_name
                }
            }
        ]
    });
    return apiaiRequest;
};
    
//Receives APIai service output
//Response is the speech string outputted from apiai service as the intended response
//can add data response processing here from apiai service later
//called from FB_processInputEvent
function apiAI_chat(apiaiRequest) {
    return new Promise((resolve, reject) => {
        apiaiRequest.on('response', function(response) {
            console.log('apiAI_chat:: APIai response accepted')
            console.log('apiAI_chat:: Response is: ',response)
            if (isDefined(response.result)) {
                console.log('apiAI_chat:: APIai service response = ', response)
                var APIai_responseText = response.result.fulfillment.speech;  //extract speech from response. This is the part to give to the FB user
                console.log('apiAI_chat:: APIai_responseText: ',APIai_responseText)
                var APIai_responseAction = response.result.action;  //extract action name from response.
                console.log('apiAI_chat:: APIai_responseAction: ',APIai_responseAction)
                //only deal with text (speech) response from APIai for now
                //add in data responses later

                if(isDefined(APIai_responseText) && isDefined(APIai_responseAction)) {   //if responseText speech exists, then send it
                    var responsedata = [APIai_responseText,APIai_responseAction]
                    resolve(responsedata);
                }
                else {
                    console.log('apiAI_chat:: APIai_responseText not defined')
                }
            }
            else {
                console.log('apiAI_chat:: APIAI response not defined')
            }
        });
        apiaiRequest.on('error', function(error) {
            console.log('apiAI_chat:: something went wrong in apiai ouput D:', error)
            reject(error);
        });
        apiaiRequest.end();
    });
};



//Get FB users FB data and return it as a JSON object
//note this function is blocking.
//Called from FB_receivedMessage
function FB_getUserInfo(sender) {
    return new Promise((resolve, reject) => {
        request({
                method: 'GET',
                uri: "https://graph.facebook.com/v2.6/" + sender + "?fields=first_name,last_name,locale,timezone,gender&access_token=" + FB_PAGE_ACCESS_TOKEN
            },
            function (error, response) {
                if (error) {
                    console.log('FB_getUserInfo:: Error while getting FB UserInfo: ', error);
                    reject(error);
                } else {
                    console.log('FB_getUserInfo:: FB UserInfo result: ', response.body);
                    resolve(response.body);
                }
            });
    });
};



//Send a FB text message using the FB Send API
function FB_sendTextMessage(sender,text) {
    var messageData = {
        recipient: {
            id: sender
        },
        message: {
            text: text,
            metadata: "Add CV metadata here"
        }
    };
    console.log("FB_sendTextMessage:: messageData: ",messageData)
    FB_sendAPI(messageData);
};

//Send a FB text message using the FB Send API with a quick reply button
function FB_sendTextMessage_quickreply(sender,text,quick_reply,qr_send_payload) {
    console.log("FB_sendTextMessage_quickreply quick_reply: ",quick_reply)
    var messageData = {
        recipient: {
            id: sender
        },
        message: {
            text: text,
            metadata: "Add CV metadata here",
            quick_replies:[
            {
                "content_type":"text",
                "title":quick_reply,
                "payload":qr_send_payload
            }]
        }
    };
    console.log("FB_sendTextMessage_quickreply:: messageData: ",messageData)
    FB_sendAPI(messageData);
};

//Use the Send API to send data to FB
function FB_sendAPI(messageData) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: messageData
    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("FB_sendAPI:: Successfully sent message with id %s to recipient %s", 
                messageId, recipientId);
            } else {
                console.log("FB_sendAPI:: Successfully called Send API for recipient %s", 
                recipientId);
            }
        } else {
            console.log("FB_sendAPI:: Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });  
};


//Sends FB message back to FB user
//called from FB_processInputEvent
function sendFBMessage(sender, messageData, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            message: messageData
        }
    }, (error, response, body) => {
        if (error) {
            console.log('sendFBMessage:: Error sending message: ', error);
        } else if (response.body.error) {
            console.log('sendFBMessage:: Error: ', response.body.error);
        }

        if (callback) {
            callback();
        }
    });
}


//Splits string s into array of elements of max length len
//Called from FB_processInputEvent
function chunkString(s, len) {
    var curr = len, prev = 0;

    var output = [];

    while (s[curr]) {
        if (s[curr++] == ' ') {
            output.push(s.substring(prev, curr));
            prev = curr;
            curr += len;
        }
        else {
            var currReverse = curr;
            do {
                if (s.substring(currReverse - 1, currReverse) == ' ') {
                    output.push(s.substring(prev, currReverse));
                    prev = currReverse;
                    curr = currReverse + len;
                    break;
                }
                currReverse--;
            } while (currReverse > prev)
        }
    }
    output.push(s.substr(prev));
    return output;
};


//called from apiAI_chat
function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
};



//Main

const app = express(); //starting express - aka starting main app script
app.use(bodyParser.text({type: 'application/json'})); //
app.get('/FBwebhook/', FB_verificationHandler); //a HTTP GET request triggers validation handshake through a function
app.post('/FBwebhook/', FB_messagePOST);

app.listen(REST_PORT, () => {
    console.log('main:: Rest service ready on port ' + REST_PORT);
});

FB_subscribeRequest();
