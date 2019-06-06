const { create } = require('./dist/index');

create()
    .then(compiler => {
        compiler.register('test', (...args) => {
            console.log(args);
        });
        if (this.window) {
            this.window.ferret = compiler;
        }

        console.log(compiler.version());
    })
    .catch(err => {
        console.log('failure');
        console.log(err);
    });
