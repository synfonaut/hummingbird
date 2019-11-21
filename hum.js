import Hummingbird from "./index"

const config = {
    rpc: { host: "209.50.56.81", user: "root", pass: "bitcoin" },
    peer: { host: "209.50.56.81" },
};

const h = new Hummingbird(config);

h.onmempool = function(tx) {
    console.log("TX", tx.tx.h);
}

h._onblock = h.onblock;
h.onblock = function(block) {
    h._onblock();
}

h.connect();
