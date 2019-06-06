const { create } = require('./dist/index');

create()
    .then(compiler => {
        if (this.window) {
            this.window.ferret = compiler;
        }

        console.log(compiler.version());
    })
    .catch(err => {
        console.log('failure');
        console.log(err);
    });
