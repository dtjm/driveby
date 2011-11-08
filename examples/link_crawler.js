var driveby = require("../driveby");
var $ = require("jquery");

function scrape(pageURL, body, window){
    $("a", window.document).each(function(i,el){
        c.enqueue($(el).attr("href"), pageURL);
    });
};

var c = new driveby.Crawler({
    scraper: scrape
});

c.enqueue(process.argv[2]);
c.start();
