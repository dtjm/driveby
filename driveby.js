var events = require("events");
var url = require("url");
var jsdom = require("jsdom");

// Constructor
var Crawler = function(opts) {
    // Configuration
    this.waitTime = 250;
    this.maxRedirectDepth = 10;
    this.scraperFunction;
    this.parseDOM = true;

    if(opts.scraper){
        this.scraperFunction = opts.scraper;
    }

    // Initialize data structures
    this.queue = [];
    this.alreadyProcessed = {};
    this.alreadyQueued = {};
    this.currentURL;
};

Crawler.prototype.start = function(){
    crawl(this);
};

Crawler.prototype.enqueue = function(urlString){
    if(this.currentURL) {
        urlString = resolveURL(this.currentURL, urlString);
    }

    if(this.alreadyProcessed[urlString]) return;
    if(this.alreadyQueued[urlString]) return;

    // Mark item as already queued
    this.alreadyQueued[urlString] = true;

    // Add url to queue
    this.queue.push(urlString);
    console.log("+  " + urlString);
};

// HELPER FUNCTIONS
// ================
function crawl(crawler) {
    var url = nextURL(crawler);
    crawler.currentURL = url;

    if(!url){
        console.log("CRAWL COMPLETE");
        return;
    }

    var crawlNext = function(){
        crawler.alreadyProcessed[url] = true;
        setTimeout(function(){
            crawl(crawler);
        }, crawler.waitTime);
    };

    fetchURL(url, 0, crawler.maxRedirectDepth).on("done", function(body){
        if(!crawler.parseDOM) {
            crawler.scraperFunction(url, body);
            crawlNext();
        } else {
            try {
            parseDOM(body).on("done", function(window){
                crawler.scraperFunction(url, body, window);
                crawlNext();
            }).on("error", function(errors){
                console.error(errors);
                crawler.scraperFunction(url, body);
                crawlNext();
            });
            } catch (e) {
                console.error("Error parsing HTML:");
                console.error(e);
                crawlNext();
            }
        }
    }).on("error", function(err){
        console.log(err);
        crawlNext();
    });
};

function fetchURL(urlString, redirectDepth, maxRedirectDepth){
    var emitter = new events.EventEmitter;

    var urlObj = url.parse(urlString);
    console.log("=> " + urlString);
    var www = getWWWClient(urlObj.protocol);

    if(!www){
        setTimeout(function(){emitter.emit("error",
                                           "invalid URL " + urlString)},
                                           0);
        return emitter;
    }


    var options = {
        host: urlObj.hostname,
        path: urlObj.pathname,
        headers: {
            "User-agent": "driveby :::::::::",
            "Accept": "text/html,text/*",
            "Accept-Encoding": "identity"
        }
    };

    if(urlObj.port) options.port = urlObj.port;
    if(urlObj.search) options.path += urlObj.search;

    www.get(options, function(res){
        switch(res.statusCode){
            case 301:
            case 302:
            case 303:
                if(redirectDepth === maxRedirectDepth) {
                    emitter.emit("error", "Redirect depth exceeded");
                }
                var redirectURL = resolveURL(urlString, res.headers.location);
                var nestedEmitter = fetchURL(redirectURL,
                                redirectDepth+1,
                                maxRedirectDepth);
                nestedEmitter.on("done", function(bodyString){
                    emitter.emit("done", bodyString);
                });
                return;
                break;
        }

        var body = [];
        res.on("data", function(chunk){
            body.push(chunk.toString());
        });
        res.on("end", function(){
            emitter.emit("done", body.join(""));
        });
    }).on("error", function(err){
        emitter.emit("error", "! Error fetching " + urlString + ": " + err);
    });

    return emitter;
};

// urlObj protocol is "http:" or "https:"
// require() the part without the colon
function getWWWClient(urlObjProtocol){
    switch(urlObjProtocol){
        case "http:":
            return require("http");
        case "https:":
            return require("https");
        default:
            return null;
    }
};

// Private function to return next URL from queue
function nextURL(crawler) {
    if(crawler.queue.length === 0) {
        return null;
    }
    var urlString = crawler.queue.shift();
    delete crawler.alreadyQueued[urlString];
    return urlString;
};

function parseDOM(body){
    var emitter = new events.EventEmitter;
    jsdom.env(body, [], {}, function(errors, window){
        if(errors){
            emitter.emit("error", errors);
            return;
        }

        // Need to do setTimeout here or else emit will happen before return
        setTimeout(function(){
            emitter.emit("done", window);
        },0);
        setTimeout(function(){window.close()},0);
    });
    return emitter;
}

function resolveURL(baseURLString, urlString){
    var urlObj = url.parse(urlString);
    var baseURLObj = url.parse(baseURLString);
    return url.format(url.resolve(baseURLString, urlObj));
}

// Export constructor
exports.Crawler = Crawler;
