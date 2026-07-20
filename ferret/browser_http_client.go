//go:build js && wasm

package ferret

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math"
	stdhttp "net/http"
	"sort"
	"strings"
	"time"

	ferrethttp "github.com/MontFerret/ferret/v2/pkg/net/http"
)

// These mirror Ferret's secure HTTP defaults while the browser-specific
// adapter delegates network I/O to Go's fetch-backed WASM transport.
const (
	browserHTTPTimeout         = 30 * time.Second
	browserHTTPMaxResponseSize = int64(16 << 20)
	browserHTTPMaxHeaderSize   = int64(1 << 20)
	browserFetchRedirectHeader = "js.fetch:redirect"
)

type browserHTTPClient struct {
	policy *ferrethttp.Policy
	client stdhttp.Client
}

func newBrowserHTTPClient(allowLocalhost bool) (*browserHTTPClient, error) {
	policy, err := ferrethttp.NewPolicy(
		ferrethttp.WithAllowLocalhost(allowLocalhost),
	)
	if err != nil {
		return nil, err
	}

	transport := stdhttp.DefaultTransport.(*stdhttp.Transport).Clone()
	transport.Proxy = nil
	transport.MaxResponseHeaderBytes = browserHTTPMaxHeaderSize

	client := &browserHTTPClient{policy: policy}
	client.client.Transport = transport
	client.client.Timeout = browserHTTPTimeout

	return client, nil
}

func (c *browserHTTPClient) Do(
	ctx context.Context,
	req *ferrethttp.Request,
) (*ferrethttp.Response, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if req == nil {
		return nil, ferrethttp.ErrNilRequest
	}

	stdReq, err := newBrowserHTTPRequest(ctx, req)
	if err != nil {
		return nil, err
	}

	if err := c.policy.Prepare(stdReq); err != nil {
		return nil, err
	}

	// Fetch follows redirects before net/http can call CheckRedirect, which
	// would bypass Ferret's redirect policy. Reject them at the browser layer.
	stdReq.Header.Set(browserFetchRedirectHeader, "error")

	res, err := c.client.Do(stdReq)
	if err != nil {
		var policyErr *ferrethttp.PolicyError

		if errors.As(err, &policyErr) {
			return nil, policyErr
		}

		return nil, err
	}

	return newBrowserHTTPResponse(res)
}

func (c *browserHTTPClient) CloseIdleConnections() {
	c.client.CloseIdleConnections()
}

func newBrowserHTTPRequest(
	ctx context.Context,
	req *ferrethttp.Request,
) (*stdhttp.Request, error) {
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = stdhttp.MethodGet
	}

	if !isValidHTTPMethod(method) {
		return nil, &ferrethttp.InvalidMethodError{Method: req.Method}
	}

	rawURL := strings.TrimSpace(req.URL)
	stdReq, err := stdhttp.NewRequestWithContext(
		ctx,
		method,
		rawURL,
		bytes.NewReader(req.Body),
	)

	if err != nil {
		return nil, &ferrethttp.URLParseError{Err: err}
	}

	if rawURL == "" {
		return nil, &ferrethttp.URLValidationError{Field: "url", Reason: "is required"}
	}

	if stdReq.URL.Scheme == "" {
		return nil, &ferrethttp.URLValidationError{Field: "scheme", Reason: "is required"}
	}

	if stdReq.URL.Host == "" {
		return nil, &ferrethttp.URLValidationError{Field: "host", Reason: "is required"}
	}

	stdReq.URL.Scheme = strings.ToLower(stdReq.URL.Scheme)
	stdReq.URL.Host = strings.ToLower(stdReq.URL.Host)
	stdReq.Host = stdReq.URL.Host
	stdReq.Header = copyBrowserHTTPHeaders(req.Headers)

	return stdReq, nil
}

func newBrowserHTTPResponse(res *stdhttp.Response) (*ferrethttp.Response, error) {
	if res == nil {
		return nil, ferrethttp.ErrNilResponse
	}

	if res.Body == nil {
		return &ferrethttp.Response{
			StatusCode: res.StatusCode,
			Status:     res.Status,
			Headers:    copyFerretHTTPHeaders(res.Header),
		}, nil
	}

	defer res.Body.Close()

	limit := saturatedIncrement(browserHTTPMaxResponseSize)
	body, err := io.ReadAll(io.LimitReader(res.Body, limit))

	if int64(len(body)) > browserHTTPMaxResponseSize {
		return nil, &ferrethttp.ResponseBodyLimitError{
			Size:  limit,
			Limit: browserHTTPMaxResponseSize,
		}
	}

	if err != nil {
		return nil, err
	}

	return &ferrethttp.Response{
		StatusCode: res.StatusCode,
		Status:     res.Status,
		Headers:    copyFerretHTTPHeaders(res.Header),
		Body:       body,
	}, nil
}

func copyBrowserHTTPHeaders(src ferrethttp.Headers) stdhttp.Header {
	dst := make(stdhttp.Header, len(src))
	keys := make([]string, 0, len(src))

	for key := range src {
		keys = append(keys, key)
	}

	sort.Strings(keys)

	for _, key := range keys {
		canonicalKey := stdhttp.CanonicalHeaderKey(key)
		dst[canonicalKey] = append(dst[canonicalKey], src[key]...)
	}

	return dst
}

func copyFerretHTTPHeaders(src stdhttp.Header) ferrethttp.Headers {
	if len(src) == 0 {
		return nil
	}

	dst := make(ferrethttp.Headers, len(src))

	for key, values := range src {
		dst[key] = append([]string(nil), values...)
	}

	return dst
}

func isValidHTTPMethod(method string) bool {
	if method == "" {
		return false
	}

	for _, character := range method {
		if character <= ' ' || character >= 127 ||
			strings.ContainsRune("()<>@,;:\\\"/[]?={}", character) {
			return false
		}
	}

	return true
}

func saturatedIncrement(value int64) int64 {
	if value == math.MaxInt64 {
		return math.MaxInt64
	}

	return value + 1
}
