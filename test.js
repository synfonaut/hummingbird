const assert = require("assert");

import txo from "txo"

import Hummingbird from "./index"
import * as tape from "./tape"
import fs from "fs"

const config = {
    rpc: { host: "127.0.0.1", user: "root", pass: "bitcoin" },
    peer: { host: "127.0.0.1" },
    reconnect: false,
};

describe("hummingbird", function() {
    this.slow(1500);

    describe("state", function() {
        it("initialize disconnected", function() {
            const h = new Hummingbird(config);
            assert.equal(h.state, Hummingbird.STATE.DISCONNECTED);
        });

        it("switches to connecting on connect", function() {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);
            h.disconnect();
        });

        it("switches to crawling after connect", function(done) {
            this.timeout(10000);

            const h = new Hummingbird(config);
            h.connect();
            h.process = function() {};
            h.isuptodate = function() { return false };

            h._onconnect = h.onconnect;
            h.onconnect = async function() {
                assert.equal(h.state, Hummingbird.STATE.CONNECTING);
                h._onconnect();

                setTimeout(function() {
                    h.isuptodate = function() { return true };
                }, 250);

                let interval = setInterval(function() {
                    if (h.state === Hummingbird.STATE.CRAWLING) {
                        clearInterval(interval);
                        assert.equal(h.state, Hummingbird.STATE.CRAWLING);
                        h.disconnect();
                        done();
                    }
                }, 100);
            };
        });

        it("disconnects", function(done) {
            const h = new Hummingbird(config);
            h.connect();

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                assert.equal(h.state, Hummingbird.STATE.CONNECTING);
                h._onconnect();
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
            (async function() {
                const h = new Hummingbird(config);

                // forcing is up to date should skip crawling step
                h.isuptodate = function() { return true };

                h._onconnect = h.onconnect;
                h.onconnect = async function() {
                    await h._onconnect();

                    setTimeout(function() {
                        assert.equal(h.state, Hummingbird.STATE.LISTENING);
                        h.reconnect = false;
                        h.disconnect();
                        done();
                    }, 300);
                };

                await h.start();
                assert.equal(h.state, Hummingbird.STATE.CONNECTING);
            })();
        });

    });

    describe("crawl", function() {
        this.timeout(15000);
        this.slow(5000);

        it("fetches blocks", function(done) {
            const h = new Hummingbird(config);
            h.onconnect = async function() {
                const block = await h.fetch(608811);
                assert(block.header.height, 608811);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");

                assert(block.txs[0].blk);
                assert.equal(block.txs[0].blk.i, 608811);
                assert.equal(block.txs[0].blk.t, 1573765073);
                assert.equal(block.txs[0].blk.h, "0000000000000000034a9d2b738eecce3e9afd8a07bc89ca03023c99f366708f");

                h.disconnect();
                done();
            };
            h.connect();
        });

        it("listens for blocks", function(done) {
            this.timeout(25000);
            this.slow(10000);

            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            h._onblock = h.onblock;
            h.onblock = function(block) {
                h._onblock(block);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");
                assert(block.header.height, 608811);

                assert(block.txs[0].blk);
                assert.equal(block.txs[0].blk.i, 608811);
                assert.equal(block.txs[0].blk.t, 1573765073);
                assert.equal(block.txs[0].blk.h, "0000000000000000034a9d2b738eecce3e9afd8a07bc89ca03023c99f366708f");

                h.disconnect();
                done();
            }

            h.ready = async function() {
                const block = await h.fetch(608811);
                assert(block.header.height, 608811);
                assert(block.txs.length, 2072);
                assert(block.txs[0].tx.h, "2086e72ce325fe377e18ee2c57f1ab5350457116a153d204354262cb131a10bc");
                assert(block.txs[2071].tx.h, "5090fb68d0f5b445050dc3eb5a58fbbca00fc433c4067fb439257a4922b6a9fe");
            };

            h.connect();
        });
    });

    describe("tape", function() {
        const tapefile = "tape_test.txt"
        const cleanup = function() { try { fs.unlinkSync(tapefile) } catch (e) {} }

        beforeEach(cleanup);
        after(cleanup);

        it("starts empty", async function() {
            assert.equal(await tape.get(tapefile), null);
        });

        it("writes", async function() {
            assert(await tape.write("BLOCK 609693 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 00000000000000000466925f21e1ad6f52ad31ff1572de70f7b1a4734e562ac9 1574304292", tapefile));
            assert.equal(await tape.get(tapefile), 609693);
        });

        it("writes multiple", async function() {
            assert(await tape.write("BLOCK 609693 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 00000000000000000466925f21e1ad6f52ad31ff1572de70f7b1a4734e562ac9 1574304292", tapefile));
            assert.equal(await tape.get(tapefile), 609693);

            assert(await tape.write("BLOCK 609694 000000000000000000ed115ae01fea88351e8e9501cd2e957f00720856172b30 000000000000000003a8d6a69e65643f3dbdf00dd36e46509ef5f6a090537f9d 1574304458", tapefile));
            assert.equal(await tape.get(tapefile), 609694);
        });
    });

    describe("peer", function() {
        this.timeout(5000);

        it("automatically reconnect", function(done) {
            const h = new Hummingbird(config);
            h.connect();
            assert.equal(h.state, Hummingbird.STATE.CONNECTING);

            let times = 0;
            h.isuptodate = function() { return false };

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                times += 1;

                if (times == 2) {
                    done();
                    h.reconnect = false;
                    h.disconnect();
                } else if (times == 1) {
                    setTimeout(function() {
                        h.isuptodate = function() { return true };
                    }, 1000);
                    h.reconnect = true;
                    h.disconnect();
                }

            };
        });

        it("listens for mempool txs", function(done) {
            this.timeout(20000);
            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            let complete = false;
            h.onmempool = function(tx) {
                if (!complete) {
                    complete = true;
                    assert(tx);
                    assert(tx.tx.h);
                    assert(tx.in);
                    assert(tx.out);
                    h.disconnect();
                    done();
                }
            }
            h.connect();
        });

        it("refreshes mempool", function(done) {
            this.timeout(10000);
            // minimum needs to be low enough that normal mempool txs don't fill it up within timeout
            // but low enough that mempool still has a shot even after a block
            let minimum = 100, num = 0;

            const h = new Hummingbird(config);
            h.isuptodate = function() { return true };
            let complete = false;
            h.onmempool = function(tx) {
                assert(tx);
                assert(tx.tx.h);
                assert(tx.in);
                assert(tx.out);

                num += 1;
                if (!complete && num >= minimum) {
                    complete = true;
                    h.disconnect();
                    done();
                }
            }

            h._onconnect = h.onconnect;
            h.onconnect = function() {
                h._onconnect();
                h.fetchmempool();
            }

            h.connect();
        });
    });

    describe("balancers", function() {
        const txhash = "01000000031e3d45c8201002d0b7fde932d038c7305fece87a5a935f92b0d6d1b66b91e18c010000006a4730440220708b56fb58bbaa18a4bea6087eedc5a371c8d64a3a4b843041f78630354c132c0220151f3e98d5b902b1af3e083c9d8c90c4eb11e8c8ebf42d3fce038a83818fa6ed41210380df51e589a247265826380eb270792c1b401bb9be7897d83d22fa1a1d09ebb7ffffffff6b95e1b467be93811f9b40a6c6bc9017a50f4eabca0efac9a6a7e1a8c0c4b717010000006a473044022033f875b2c257bb9c04c7a26293d626e1fd0ca1790d53a39da42f5b6007e89d7c02203260a274bca14dea98f726e65d38fe4740ee016dbc8eac9efaf320828cb1843e412103d290fbd5576e16da567be901c8088ac5da9a5d5d816c80df69eca96034f73116ffffffff50dc2b2c744c096e1a09ba898087f0aa82ffbd24d1bfdedf8daf9f966789fb2c010000006b483045022100f4bfbd05a222132eb1896d9a1c83eeee4115ded0b3d82a9984d101703139c2d30220377913b3fe7a75208d0419c189f4fe452ad942b8ca285198dcc27161f18973034121032bfd1463f20f8fd431a8bdf0c81a3635ae345fba57e4f79b1f26ddbe3aadce24ffffffff02164c0400000000001976a914a78b9ede98117ffa2319bc9e6aa5609b80bcb95488ac011f0b00000000001976a91462202eebc76f59988915c8b89793a0d41fadbd3488ac00000000";

        it("none", async function() {
            const tx = await txo.fromTx(txhash);
            assert(tx);

            assert.equal(tx.tx.h, "3e410bfba6732687369b3e961030c8bf88793be99bb297247bef64fec141a04e");
            const h = new Hummingbird(config);
            await h.onmempool(tx);
        });

        it("single state machine", async function() {
            const tx = await txo.fromTx(txhash);

            let num = 0;
            class StateMachine {
                ontransaction() { num += 1 }
            }

            assert(tx);

            assert.equal(tx.tx.h, "3e410bfba6732687369b3e961030c8bf88793be99bb297247bef64fec141a04e");
            const h = new Hummingbird(Object.assign({}, config, { state_machines: [new StateMachine()] }));

            assert.equal(num, 0);
            await h.onmempool(tx);
            assert.equal(num, 1);

        });

        it("multiple state machines", async function() {
            const tx = await txo.fromTx(txhash);

            let num = 0;
            class StateMachine {
                ontransaction() { num += 1 }
            }

            assert(tx);

            assert.equal(tx.tx.h, "3e410bfba6732687369b3e961030c8bf88793be99bb297247bef64fec141a04e");
            const h = new Hummingbird(Object.assign({}, config, { state_machines: [
                new StateMachine(),
                new StateMachine(),
            ]}));

            assert.equal(num, 0);
            await h.onmempool(tx);
            assert.equal(num, 2);

        });

        it("many state machines", async function() {
            const tx = await txo.fromTx(txhash);

            let num = 0;
            class StateMachine {
                ontransaction() { num += 1 }
            }

            assert(tx);

            assert.equal(tx.tx.h, "3e410bfba6732687369b3e961030c8bf88793be99bb297247bef64fec141a04e");
            const h = new Hummingbird(Object.assign({}, config, { state_machines: [
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
                new StateMachine(),
            ]}));

            assert.equal(num, 0);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            await h.onmempool(tx);
            assert.equal(num, 100);

        });

        it("stops on error", async function() {

            const tx = await txo.fromTx(txhash);

            let num = 0;
            class StateMachine {
                ontransaction() {
                    throw new Error("bzz wrong");
                    num += 1;
                }
            }

            assert(tx);

            assert.equal(tx.tx.h, "3e410bfba6732687369b3e961030c8bf88793be99bb297247bef64fec141a04e");
            const h = new Hummingbird(Object.assign({}, config, { state_machines: [new StateMachine()] }));

            assert.equal(num, 0);
            try {
                await h.onmempool(tx);
                assert.fail("expected error");
            } catch (e) {
                assert.equal(e.message, "bzz wrong");
                assert.equal(num, 0);
            }
        });

        it("stops processing mempool while crawling old blocks", function(done) {
            this.timeout(60000);

            let processingBlock = false;
            let receivedTXDuringBlock = false;
            let curr = 612566;
            let complete = false;

            class TestHummingbird extends Hummingbird {
                async curr() {
                    return curr;
                }

                async height() {
                    this.blockheight = 612568;
                    return this.blockheight;
                }

                async onrealtime() {
                    setTimeout(function() {
                        assert(!receivedTXDuringBlock);
                        assert(!complete);
                        hum.reconnect = false;
                        hum.disconnect();
                        done();
                    }, 300);
                }
            }

            class StateMachine {
                onmempool(tx) {
                    if (processingBlock) {
                        receivedTXDuringBlock = true;
                    }
                }

                ontransaction(tx) {
                    //console.log("TX", tx.tx.h);
                }

                ontransactions(txs, block) {
                    curr = 612568;
                    processingBlock = false;
                }
            }

            const hum = new TestHummingbird(Object.assign({}, config, {
                state_machines: [new StateMachine()]
            }));

            hum.onconnect = async function() {
                await hum.height();
                processingBlock = true;
                await hum.crawl();
            }


            hum.start();
        });

        it("keeps processing mempool while crawling recent blocks", function(done) {
            this.timeout(60000);

            let processingBlock = false;
            let receivedTXDuringBlock = false;
            let curr = 612567;
            let complete = false;

            class TestHummingbird extends Hummingbird {
                async curr() {
                    return curr;
                }

                async height() {
                    this.blockheight = 612568;
                    return this.blockheight;
                }
            }

            class StateMachine {
                onmempool(tx) {
                    if (processingBlock) {
                        receivedTXDuringBlock = true;

                        if (!complete) {
                            complete = true;
                            assert(receivedTXDuringBlock);
                            hum.reconnect = false;
                            hum.disconnect();
                            done();
                        }
                    }

                }

                ontransaction(tx) {
                    //console.log("TX", tx.tx.h);
                }

                ontransactions(txs, block) {
                    curr = 612568;
                }
            }

            const hum = new TestHummingbird(Object.assign({}, config, {
                state_machines: [new StateMachine()]
            }));

            hum._crawl = hum.crawl;
            hum.crawl = async function crawl() {
                processingBlock = true;
                await hum._crawl();

                setTimeout(function() {
                    processingBlock = false;
                }, 1000);
            };

            hum.onconnect = async function() {
                await hum.height();
                await hum.crawl();
            }


            hum.start();
        });
    });

    describe("mempool mode", function() {
        it("doesn't crawl in mempool mode", function(done) {
            this.timeout(30000);

            const h = new Hummingbird(Object.assign({}, config, {
                mode: Hummingbird.MODE.MEMPOOL,
            }));

            h.crawl = async function() {
                throw new Error("invalid crawl block");
            };

            h.height = async function() {
                return 612601;
            }

            h.curr = async function() {
                return 612601;
            }

            h.listen = async function() {
                h.disconnect();
                done();
            };

           h.start();
        });

        it("listens until block chain catches up", function(done) {
            this.timeout(30000);

            const h = new Hummingbird(Object.assign({}, config, {
                mode: Hummingbird.MODE.MEMPOOL,
            }));

            let curr = 612600;

            h.crawl = async function() {
                throw new Error("invalid crawl block");
            };

            h.height = async function() {
                return 612601;
            }

            h.curr = async function() {
                return curr;
            }

            h.listen = async function() {
                h.disconnect();
                done();
            };

           h.start();

            setTimeout(function() {
                curr += 1;
            }, 1000);
        });

    });

    describe("block mode", function() {
        it("doesn't wait in block mode", function(done) {
            this.timeout(30000);

            const h = new Hummingbird(Object.assign({}, config, {
                mode: Hummingbird.MODE.BLOCK,
            }));

            let curr = 612600;

            h.wait = async function() {
                throw new Error("invalid wait in block mode");
            };

            h.height = async function() {
                return 612601;
            }

            h.curr = async function() {
                return curr;
            }

            h.listen = async function() {
                h.disconnect();
                done();
            };

            setTimeout(function() {
                curr += 1;
            }, 300);

           h.start();
        });
    });
});

