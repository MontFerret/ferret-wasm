import path from 'path';
import { expect } from 'chai';
import { create } from '../../js/index';
import { Engine } from '../../js/engine';

describe('Compiler.register', () => {
    let compiler: Engine;

    before(done => {
        create(path.join(__dirname, '../../dist/ferret.wasm'))
            .then(engine => {
                compiler = engine;
            })
            .finally(done);
    });

    it('should register and execute a user defined functions', () => {
        const values: any[] = [];

        compiler.register('test', (...args: any[]) => {
            args.forEach(i => values.push(i));
        });

        return compiler
            .exec(`RETURN TEST(1, 'foo', { bar: 'baz'})`)
            .then(() => {
                expect(values).to.eql([1, 'foo', { bar: 'baz' }]);
            });
    });

    it('should handle return values', () => {
        compiler.register('test2', (...args: any[]) => {
            return 'FOO';
        });

        return compiler
            .exec(
                `
                LET res = TEST2()
                
                RETURN res + "_" + "BAR"
            `,
            )
            .then(out => {
                expect(out).to.eql('FOO_BAR');
            });
    });

    it('should handle async function', () => {
        compiler.register('async1', async (..._: any[]) => {
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve('FOO');
                }, 10);
            });
        });

        return compiler
            .exec(
                `
                LET res = ASYNC1()
                
                RETURN res + "_" + "BAR"
            `,
            )
            .then(out => {
                expect(out).to.eql('FOO_BAR');
            });
    });
});
