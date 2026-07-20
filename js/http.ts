export interface HTTPTransportRequest {
    method: string;
    url: string;
    headers: Record<string, string[]>;
    body: Uint8Array;
    maxResponseSize: number;
    maxResponseHeaderSize: number;
}

export interface HTTPTransportResponse {
    statusCode: number;
    status: string;
    headers: Record<string, string[]>;
    body: Uint8Array;
    bodySizeExceeded?: boolean;
    observedBodySize?: number;
}

export type AddressValidator = (address: string) => string | undefined;

export interface HTTPTransport {
    request(
        request: HTTPTransportRequest,
        signal: AbortSignal,
        validateAddress: AddressValidator,
    ): Promise<HTTPTransportResponse>;
    close(): void;
}

export function responseHeaderSize(
    headers: Iterable<readonly [string, string]>,
): number {
    let size = 2;
    const encoder = new TextEncoder();

    for (const [name, value] of headers) {
        size +=
            encoder.encode(name).byteLength +
            encoder.encode(value).byteLength +
            4;
    }

    return size;
}

export function headerLimitError(limit: number): Error {
    return new Error(`http: response headers exceeded ${limit} bytes`);
}
