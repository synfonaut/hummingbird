const assert = require("assert");

import Hummingbird from "./index"

const host = "209.50.56.81";

describe.only("hummingbird", function() {
    describe("state", function() {
        it("initialize disconnected", function() {
            const h = new Hummingbird({ peer: { host } });
            assert.equal(h.state, Hummingbird.STATE.DISCONNECTED);
        });

        it("switches to connecting on connect", function() {
            const h = new Hummingbird({ peer: { host } });
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);
            h.disconnect();
        });

        it("switches to crawling after connect", function(done) {
            const h = new Hummingbird({ peer: { host } });
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                h.isuptodate = function() { return true };
                h.disconnect();
                done();
            };
        });

        it("disconnects", function(done) {
            const h = new Hummingbird({ peer: { host } });
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                h.disconnect();
            };

            h._ondisconnect = h.ondisconnect;
            h.ondisconnect = function() {
                h._ondisconnect();
                assert.equal(h.state, Hummingbird.STATE.DISCONNECTED);
                h.isuptodate = function() { return true };
                done();
            };
        });

        it("switches to listening after crawl", function(done) {
            const h = new Hummingbird({ peer: { host } });
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            // forcing is up to date should skip crawling step
            h.isuptodate = function() { return true };

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.LISTENING);
                h.disconnect();
                done();
            };
        });

        it("switches from crawling to listening back to crawling", function(done) {
            const h = new Hummingbird({ peer: { host } });
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                h.isuptodate = function() { return true };
            };

            h._listen = h.listen;
            let complete = false; // listen will call itself recursively if we don't add a complete check
            h.listen = async function() {
                if (!complete) {
                    h._listen();
                    assert.equal(h.state, Hummingbird.STATE.LISTENING);
                    h.isuptodate = function() { return false }; // new block comes in
                    h.onblock();
                    assert.equal(h.state, Hummingbird.STATE.CRAWLING);

                    h.isuptodate = function() { return true };

                    complete = true;
                    done();
                    h.disconnect();
                }
            };
        });
    });
});


// start
//  b2p2p
// disconnect
//  reconnect
// onblock
//  crawl
//  refreshmempool
// onmempool
// check
// crawl
//  rpc
//  tape
