const { create, isNode } = require('./dist/index');

create()
    .then(compiler => {
        console.log(compiler.version());

        if (!isNode) {
            window.ferret = compiler;
        } else if (process.argv.length > 2) {
            const fs = require('fs');
            const file = fs.readFileSync(process.argv[2]);

            debugger;
            return compiler.exec(file.toString());
        }

        return '';
    })
    .then(out => {
        console.log('success');

        if (out) {
            console.log(out);
        }

        process.exit(0);
    })
    .catch(err => {
        console.log('failure');
        console.log(err);

        if (isNode) {
            process.exit(1);
        }
    });
