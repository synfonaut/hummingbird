const log = require("debug")("hummingbird:helpers");

export function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export function connect(dbname) {
    const MongoClient = require("mongodb");
    return new Promise((resolve, reject) => {
        MongoClient.connect("mongodb://localhost:27017", { useNewUrlParser: true, useUnifiedTopology: true }, function(err, client) {
            if (err) {
                setTimeout(function() {
                    log("retrying db...");
                    connect().then(resolve);
                }, 1000);
            } else {
                log(`connected to ${dbname}`);
                const db = client.db(dbname);
                db.close = function() { return client.close() }
                resolve(db);
            }
        });
    });
};

export function isdupeerror(e, keys=[]) {
    if (e.name !== "MongoError") {
        //console.log("wrong error during dupe", JSON.stringify(e, null, 4), keys);
        return false;
    }
    if (e.code !== 11000) {
        //console.log("wrong error code during dupe", JSON.stringify(e, null, 4), keys);
        return false;
    }

    if (e.keyPattern) {
        for (const key of keys) {
            if (!e.keyPattern[key]) {
                //console.log("wrong key pattern", key, "during dupe", JSON.stringify(e, null, 4), keys);
                return false;
            }
        }
    } else {
        for (const key of keys) {
            if (e.errmsg.indexOf(key) == -1) {
                //console.log("wrong key pattern", key, "during dupe", JSON.stringify(e, null, 4), keys);
                return false;
            }
        }
    }

    return true;
}

