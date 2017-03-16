#!/usr/bin/env python

import urllib
import json
import os

import psycopg2 #required for heroku postgres db access
import psycopg2.extras
import urlparse #used for db access

from flask import Flask
from flask import request
from flask import make_response

# Flask app should start in global layout
app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    print "Webhook starting up!"

    dbAction('yes')

    req = request.get_json(silent=True, force=True)
    print "Request is %s" % req
    res = processRequest(req)   #Receive data from api.ai and retrieve request data
    res = json.dumps(res, indent=4)
    r = make_response(res)      #Use retrieved data to form response to api.ai
    r.headers['Content-Type'] = 'application/json'
    print "Webhook finished with output %s" % r
    print "Output content %s" % res
    return r

def processRequest(req):    #Parse data provided to script and retrieve request data
    print "Process webhook request"
    action = req.get("result").get("action")
    if action == "current_price":
        res = current_price(req)
    elif action == "day_price_range":
        res = day_price_range(req)
    elif action == "watchlist":
        res = watchlist(req)
    elif action == "watchlist_add":
        res = watchlist_add(req)
    elif action == "watchlist_remove":
        res = watchlist_remove(req)
    else:
        return {}
    return res

def dbAction(returnall, query='1', data='1'): #assign value to make them optional params
    # connectionString 
    urlparse.uses_netloc.append('postgres')
    url = urlparse.urlparse(os.environ['DATABASE_URL'])
    print "Attempting DB connection"
    try:    #attempt to connect to db
        conn = psycopg2.connect("dbname=%s user=%s password=%s host=%s " % (url.path[1:], url.username, url.password, url.hostname)) #apparently we don't have to fully define these params
        print "Successfully connected to DB"
    except:
        print 'Unable to connect to DB D:'
        return

    #open cursor to perform DB actions
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    print "Query string: ", query
    print "Data string: ", data

    if(query != '1' and data != '1'): #if query and data are supplied then execute query
        print "query with data"
        cur.execute(query,data)
        print "query successful"
    elif(query != '1' and data == '1'):  #if query supplied with no data supplied then just execute basic query
        print "simple no data query"
        cur.execute(query)
        print "query successful"

    if(returnall == 'yes' or returnall == 'YES' or returnall == 'Yes'): #check if want to perform select * from
        print "display all"
        cur.execute("SELECT * FROM userDB;")
        print "query successful"
    
    try:
        print "Attempt to get DB output"
        output = cur.fetchall()
        print "DB output: ", output
        print "DB output contents:"
        for row in output:
            print "    ", row
        print 'End of DB output'
        conn.commit()   #submit changes to db
        cur.close()     #close db cursor
        conn.close()    #close db connection
        return output

    except:
        conn.commit()   #submit changes to db
        cur.close()     #close db cursor
        conn.close()    #close db connection
        print "No DB output"
        return

def watchlist(req):
    print 'Request watchlist'
    userID = req[u'result'][u'contexts'][0][u'parameters'][u'fb_userid']
    user_firstname = req[u'result'][u'contexts'][0][u'parameters'][u'fb_firstname']
    query = 'SELECT * FROM userdb WHERE userid = %s;'
    output = dbAction('no',query,(userID,))
    print "output: ", output
    
    if (len(output) == 0):
        print 'User watchlist not yet setup'
        speech = "Uh oh! You haven't set up your watchlist yet. If you ask me to add a stock to your watchlist we can get you set up"
        return {"speech": speech, "displayText": speech, "source": "cv-asxdata"}

    elif (len(output) != 1):
        print 'Duplicate users found'
        #Add more error debug here
        return {"speech": "Duplicate users found", "displayText": "Duplicate users found", "source": "cvdata"}

    stocklist = output[0][2]
    print "Stocklist: ", stocklist

    if len(stocklist) == 0:
        print 'No stocks in watchlist'
        speech = 'Uh oh! Your watchlist is empty. You can say "Add XXX to my watchlist" using the company code or name.'
        return {"speech": speech, "displayText": speech, "source": "cv-asxdata"}
    speech = user_firstname + "'s " + watchlist_prices(stocklist)

    return {"speech": speech, "displayText": speech, "source": "cv-asxdata"}



def watchlist_add(req):
    print "Request: watchlist_add"
    stock_add = req[u'result'][u'contexts'][0][u'parameters'][u'ASX_stock']
    userID = req[u'result'][u'contexts'][0][u'parameters'][u'fb_userid']
    user_firstname = req[u'result'][u'contexts'][0][u'parameters'][u'fb_firstname']
    user_lastname = req[u'result'][u'contexts'][0][u'parameters'][u'fb_lastname']
    print "stock is: ", stock_add
    print "fb userID is: ", userID
    print "fb firstname is: ", user_firstname
    print "fb lastname is: ", user_lastname

    query = 'SELECT * FROM userDB WHERE userid = %s;'
    output = dbAction('no',query,(userID,))
    print "output: ", output

    if(len(output) == 0):
        print 'User watchlist not yet setup'
        query = "INSERT INTO userDB(userid, username, watchlist) VALUES (%s, %s, %s);"
        username = "{\"" + user_firstname + "\", \"" + user_lastname + "\"}"
        stock = "{\"" + stock_add + "\"}"
        data = (userID, username, stock)

    elif (len(output) != 1):
        print 'Duplicate users found'
        #Add more error debug here
        return {"speech": "Duplicate users found", "displayText": "Duplicate users found", "source": "cvdata"}

    else:
        stocklist = output[0][2]
        print "Stocklist: ", stocklist

        if stock_add in stocklist:
            speech = stock_add + " is already in your watchlist. You can't add it again!"
            return {"speech": speech, "displayText": speech, "source": "cvdata"}

        print "not already in watchlist"
        stocklist.append(stock_add)
        print "Updated stocklist: ", stocklist

        query = "UPDATE userDB SET watchlist = %s where userid = %s;"
        data = (stocklist,userID)

    output = dbAction('no',query,data)

    dbAction('yes')

    speech = "Easy as! " + stock_add + ' is now in your watchlist'
    return {"speech": speech, "displayText": speech, "source": "cvdata"}


def watchlist_remove(req):
    print "Request: watchlist_remove"
    stock_rm = req[u'result'][u'contexts'][0][u'parameters'][u'ASX_stock']
    userID = req[u'result'][u'contexts'][0][u'parameters'][u'fb_userid']
    print "stock is: ", stock_rm
    print "fb userID is: ", userID

    query = 'SELECT * FROM userDB WHERE userid = %s;'
    output = dbAction('no',query,(userID,))
    print "output: ", output

    if(len(output) == 0):
        print 'User watchlist not yet setup'
        speech = "You haven't set up your watchlist yet. If you ask me to add a stock to your watchlist we can get you set up"
        return {"speech": speech, "displayText": speech, "source": "cv-asxdata"}

    elif (len(output) != 1):
        print 'Duplicate users found'
        #Add more error debug here
        return {"speech": "Duplicate users found", "displayText": "Duplicate users found", "source": "cvdata"}

    stocklist = output[0][2]
    print "Stocklist: ", stocklist

    if stock_rm in stocklist:
        stocklist_new = []
        for ii in range (len(stocklist)):
            if stock_rm != stocklist[ii]:
                stocklist_new.append(stocklist[ii])
        
        query = "UPDATE userDB SET watchlist = %s where userid = %s;"
        output = dbAction('no',query,(stocklist_new,userID))
        dbAction('yes')
        speech = 'No prob! ' + stock_rm + ' has been removed from your watchlist'
        return {"speech": speech, "displayText": speech, "source": "cvdata"}
    speech = "Huh? " + stock_rm + " isn't even in your watchlist"
    return {"speech": speech, "displayText": speech, "source": "cvdata"}   



def watchlist_prices(stocklist):
    print "Retrieve stocklist prices"
    stocklist_prices = []
    speech = 'watchlist:'
    for ii in range (len(stocklist)):
        stock = stocklist[ii]
        print stock
        url = makeURL(stock)
        data = getdata(url)
        print "Web data: %s" % data
        code = data.get('code')     #get data
        if code is None:
            print "Something failed. No web data retrieved"
            return {}
        last_price = data.get('last_price')
        if last_price is None:
            return {}
        change_in_percent = data.get('change_in_percent')
        if change_in_percent is None:
            return {}
        #build output string
        speech = speech + "\n" + stock + ': ' + str(last_price) + ' (' + str(change_in_percent) + ")"

    return speech

    
def current_price(req):    #Parse data provided to script and retrieve request data
    result = req.get("result")      #grab data from api.ai input
    parameters = result.get("parameters")
    stock = parameters.get("ASX_stock")
    if stock is None:
        return None
    url = makeURL(stock)
    data = getdata(url)

    print "Web data: %s" % data
    code = data.get('code')     #get data
    if code is None:
        print "Something failed. No web data retrieved"
        return {}
    last_price = data.get('last_price')
    if last_price is None:
        return {}
    change_in_percent = data.get('change_in_percent')
    if change_in_percent is None:
        return {}
    #build output string
    speech = "The current price for " + code + " is " + str(last_price) + " (percentage change " + str(change_in_percent) + ")"
    return {"speech": speech, "displayText": speech, "source": "cv-asxdata"}

def day_price_range(req):    #Parse data provided to script and retrieve request data
    data = getdata(req)
    print "Web data: %s" % data
    code = data.get('code')     #get data
    if code is None:
        print "Something failed. No web data retrieved"
        return {}
    day_high_price = data.get('day_high_price')
    if day_high_price is None:
        return {}
    day_low_price = data.get('day_low_price')
    if day_low_price is None:
        return {}
    #build output string
    speech = code + " last traded between " + str(day_low_price) + " and " + str(day_high_price)
    return {"speech": speech, "displayText": speech, "source": "cv-asxdata"}


def makeURL(stock):   #construct request url
    #url = "http://data.asx.com.au/data/1/share/XXX/"
    print "Build data url"
    baseurl = "http://data.asx.com.au/data/1/share/"    #url root
    fullURL = baseurl + stock + "/"     #build url
    print "URL: %s" % fullURL
    return fullURL

def getdata(url):
    print "Get web data"
    result = urllib.urlopen(url).read() #read target url
    data = json.loads(result)   #grab target url json data
    return data


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    print "Starting app on port %d" % port
    app.run(debug=False, port=port, host='0.0.0.0')
