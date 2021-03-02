export function assert(input: any): void {
    if (input == null) {
        throw new Error('Unexpected result');
    }
}
