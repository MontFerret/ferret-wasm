export function assert(input): void {
    if (input == null) {
        throw new Error('Unexpected result');
    }
}
