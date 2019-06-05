const create = require('./dist/index');

create()
    .then(compiler => {
        window.ferret = compiler;
    })
    .catch(err => {
        console.log('failure');
        console.log(err);
    });
