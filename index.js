// Load dependencies
var
events = require("events"),
url    = require("url"),
jsdom  = require("jsdom"),
_      = require("underscore")

// Crawler constructor
// -------------------
var Crawler = function(opts) {

    // Set default configuration
    this.cfg = {
        // Number of millisecond to wait before fetching next URL
        waitTime: 0,
        // Max number of redirects to follow before quitting
        maxRedirectDepth: 10,
        // Whether to parse the HTML into a DOM document
        parseDOM: true,
        // A function to pre-filter the body before parsing the DOM
        bodyFilter: null,
        // Callback to act on the fetched document
        callback: null,
        // Extra output
        verbose: false
    };

    // Apply the passed-in arguments over the defaults
    _.extend(this.cfg, opts);

    // Initialize member data structures
    // ---------------------------------

    // List of urls to process
    this.queue = [];
    // List of URLs already processed
    this.alreadyProcessed = {};
    // List of URLs currently in the queue
    this.alreadyQueued = {};
    // Current URL being processed
    this.currentURL;
};

// Starts the crawl process. The crawler will fetch one URL at a time.
Crawler.prototype.start = function(){
    crawl(this);
};

// Add an item to the queue
Crawler.prototype.enqueue = function(urlString){
    // Resolve relative URLs against the current URL
    if(this.currentURL) {
        urlString = resolveURL(this.currentURL, urlString);
    }

    // Skip duplicate entries
    if(this.alreadyProcessed[urlString]) return;
    if(this.alreadyQueued[urlString]) return;

    // Mark item as already queued
    this.alreadyQueued[urlString] = true;

    // Add url to queue
    this.queue.push(urlString);
    if(this.cfg.verbose) console.log(" +  " + urlString);
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
            if(crawler.cfg.verbose)
                console.log("" + crawler.queue.length + " URLs remaining");

            crawl(crawler);
        }, crawler.cfg.waitTime);
    };

    var fetch = function(){
        fetchURL(url, 0, crawler.cfg.maxRedirectDepth).on("done", function(body){
            if(!crawler.cfg.parseDOM) {
                crawler.cfg.callback(url, body);
                crawlNext();
            } else {
                if(_.isFunction(crawler.cfg.bodyFilter))
                    body = crawler.cfg.bodyFilter(body);

                try {
                    parseDOM(body).on("done", function(window){
                        crawler.cfg.callback(url, body, window);
                        crawlNext();
                    }).on("error", function(errors){
                        console.error("[driveby] parseDOM error".red);
                        console.error(errors);
                        crawlNext();
                    });
                } catch (e) {
                    console.error("[driveby] Error parsing HTML".red);
                    console.error(e);
                    crawlNext();
                }
            }
        }).on("error", function(err){
            console.error("[driveby] fetchURL error".red);
            console.error(err);
            crawlNext();
        });
    };

    // If the prefetch filter doesn't exist, or if it emits a "yes", then go
    // ahead with the fetch
    if(!crawler.prefetchFilter){
        fetch();
    }
    if(_(crawler.prefetchFilter).isFunction()){
        crawler.prefetchFilter(url)
               .on("yes", fetch)
               .on("no", crawlNext);
    }
};

function fetchURL(urlString, redirectDepth, maxRedirectDepth){
    var emitter = new events.EventEmitter;

    var urlObj = url.parse(urlString);

    // Display URL in output
    if(redirectDepth === 0) 
        console.log("=> " + urlString);
    else
        console.log(" R " + urlString);

    var www = getWWWClient(urlObj.protocol);

    // Couldn't get a proper http/https client
    if(!www){
        setTimeout(function(){
            emitter.emit("error", "invalid URL " + urlString)
        },0);

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
    try {
    jsdom.env(body, [], null, function(errors, window){
        if(errors){
            setTimeout(function(){emitter.emit("error", errors);}, 0);
            return;
        }

        // Need to do setTimeout here or else emit will happen before return
        setTimeout(function(){
            emitter.emit("done", window);
        },0);
        setTimeout(function(){window.close()},0);
    });
    } catch (e) {
        setTimeout(function(){emitter.emit("error", e)}, 0);
    }
    return emitter;
}

/**
 * @private
 */
function resolveURL(baseURLString, urlString){
    var urlObj = url.parse(urlString);
    var baseURLObj = url.parse(baseURLString);
    return url.format(url.resolve(baseURLString, urlObj));
}

// Export constructor
module.exports = Crawler;
