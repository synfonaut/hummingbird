import fs from "fs"
import ReadLastLines from "read-last-lines"

export function get(file) {
    return new Promise((resolve, reject) => {
        ReadLastLines.read(file).then(str => {
            const lines = str.split("\n").filter(line => !!line);
            const last = lines.pop();
            const line = last.split(" ");
            if (line.length !== 4) { throw new Error("expected tape to have 4 elements") }
            const height = Number(line[0]);
            resolve(height);
        }).catch(e => {
            resolve(null);
        });
    });
}

export function write(line, file) {
    return new Promise((resolve, reject) => {
        try {
            fs.appendFileSync(file, `${line}\n`);
            resolve(true);
        } catch (e) {
            reject(e);
        }
    });
}
