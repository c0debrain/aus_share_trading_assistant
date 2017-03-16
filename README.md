# Australian Share Trading Assistant
Facebook Messenger chatbot that provides current current ASX share price data using NLP.

The Facebook Messenger chatbot can be found here:
https://www.facebook.com/australian.share.trading.assistant/

Data is sourced from http://data.asx.com.au/data/1/share/XXX/ where XXX is the requested stock code.
(Data is delayed by 20min)

Solution consists of:

(1). Node.js script

(2). Python script

(3). API.ai link

(4). Heroku host

(5). PostgreSQL database


1) Node.js script
This script provides the interface between the user interactions on Facebook Messenger and the API.ai platform. The user input text is passed directly to the API.ai conversational intelligence platform for processing. The processed input text is returned from API.ai ready to return to the user. This script manages all Facebook authentication requirements and prepares user information to be assigned to the user database. This script also manages the user onboarding process by guiding new users through a short tutorial format.

2) Python script
This script is called from API.ai to collect the live ASX web data. The script receives the processed request from API.ai, retrieves the required data and forms the return response. This script also manages the PostgreSQL user database. Data is sourced from http://data.asx.com.au/data/1/share/XXX/ where XXX is the requested stock code.
(Data is delayed by 20min)


3) API.ai link
API.ai is used to process the natural language input user text to allow for the user to complete requests in non-structured formats. User input text is passed to API.ai by the Node.js script for processing. The processed user input request is passed to the python string to collect the required web or database data. The response is then passed back to the Node.js script to be returned to the user. The API.ai platform can be trained to improve the recognition capabilities of the natural language request analyser.
API.ai [http://api.ai]

4) Heroku host
Heroku is used to cloud host the Node.js script, python script and the PostgreSQL user database.
Heroku [https://heroku.com/]

5) PostgreSQL database
A user database is maintained which only contains the Facebook Messenger page userID and the watchlist share list. The Facebook Messenger page userID is unique for each Facebook user for each Facebook Page and does not provide any identifiable information. The Facebook Messenger page userID persists when the user communicates with the same Facebook Page using Facebook Messenger. The watchlist share list is stored as a list of 3 character share codes, e.g. (ANZ, BHP, CBA). No user identifiable information is stored in the database. All user identifiable information that is used by the Node.js script is received and returned within each Facebook Messenger message action.


Thanks to https://github.com/api-ai/api-ai-facebook for providing the foundation of the Node.js script and the Facebook Messenger and API.ai connection.


Thanks for your interest.

Chris
