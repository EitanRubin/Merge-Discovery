export const HTTP_PATTERNS = {
    // Native Browser APIs
    fetch: ['fetch', 'window.fetch', 'globalThis.fetch'],
    xhr: ['XMLHttpRequest', 'new XMLHttpRequest'],
    
    // Popular HTTP Libraries
    axios: ['axios', 'axios.get', 'axios.post', 'axios.put', 'axios.delete', 'axios.patch', 'axios.head', 'axios.options', 'axios.request', 'axios.create'],
    
    // jQuery
    jquery: ['$.ajax', '$.get', '$.post', '$.put', '$.delete', '$.getJSON', '$.load', 
             'jQuery.ajax', 'jQuery.get', 'jQuery.post', 'jQuery.getJSON', 'jQuery.load'],
    
    // Angular
    angular: ['http.get', 'http.post', 'http.put', 'http.delete', 'http.patch', 'http.head', 'http.options',
              'httpClient.get', 'httpClient.post', 'httpClient.put', 'httpClient.delete', 'httpClient.patch',
              '$http.get', '$http.post', '$http.put', '$http.delete', '$http.patch'],
    
    // Node.js Libraries
    request: ['request', 'request.get', 'request.post', 'request.put', 'request.delete', 'request.patch', 'request.head'],
    superagent: ['superagent', 'request'],  // superagent uses 'request' as alias
    got: ['got', 'got.get', 'got.post', 'got.put', 'got.delete', 'got.patch', 'got.head'],
    needle: ['needle', 'needle.get', 'needle.post', 'needle.put', 'needle.delete', 'needle.patch', 'needle.head'],
    ky: ['ky', 'ky.get', 'ky.post', 'ky.put', 'ky.delete', 'ky.patch', 'ky.head'],
    
    // React/Next.js specific
    swr: ['useSWR', 'mutate'],
    reactQuery: ['useQuery', 'useMutation', 'queryClient.fetchQuery'],
    
    // GraphQL
    apollo: ['client.query', 'client.mutate', 'apolloClient.query', 'apolloClient.mutate'],
    graphql: ['graphql', 'execute', 'subscribe'],
    
    // WebSocket (HTTP upgrade)
    websocket: ['WebSocket', 'new WebSocket', 'io.connect', 'socket.io'],
    
    // Utilities and wrappers
    wretch: ['wretch'],
    redaxios: ['redaxios'],
    
    // Framework specific
    vue: ['$http', 'this.$http'],
    nuxt: ['$axios', '$fetch', 'useFetch', 'useLazyFetch'],
    
    // Testing libraries
    nock: ['nock'],
    msw: ['rest.get', 'rest.post', 'graphql.query'],
    
    // PHP HTTP Libraries
    php_curl: ['curl_exec', 'curl_init', 'curl_setopt'],
    php_guzzle: ['Client', 'get', 'post', 'put', 'delete', 'patch', 'request'],
    php_http: ['file_get_contents', 'stream_context_create'],
    
    // Python HTTP Libraries
    python_requests: ['requests.get', 'requests.post', 'requests.put', 'requests.delete', 'requests.patch', 'requests.head', 'requests.options'],
    python_urllib: ['urllib.request', 'urlopen', 'Request'],
    python_httpx: ['httpx.get', 'httpx.post', 'httpx.put', 'httpx.delete', 'httpx.patch'],
    python_aiohttp: ['aiohttp.get', 'aiohttp.post', 'aiohttp.put', 'aiohttp.delete'],
    
    // Java HTTP Libraries
    java_httpclient: ['HttpClient', 'send', 'sendAsync'],
    java_okhttp: ['OkHttpClient', 'Request.Builder', 'Call'],
    java_resttemplate: ['RestTemplate', 'getForObject', 'postForObject', 'put', 'delete'],
    java_webclient: ['WebClient', 'retrieve', 'exchange'],
    
    // C# .NET HTTP Libraries
    csharp_httpclient: ['HttpClient', 'GetAsync', 'PostAsync', 'PutAsync', 'DeleteAsync'],
    csharp_restsharp: ['RestClient', 'Execute', 'ExecuteAsync'],
    csharp_webclient: ['WebClient', 'DownloadString', 'UploadString'],
    
    // Ruby HTTP Libraries
    ruby_net_http: ['Net::HTTP', 'get', 'post', 'put', 'delete'],
    ruby_faraday: ['Faraday.get', 'Faraday.post', 'Faraday.put', 'Faraday.delete'],
    ruby_httparty: ['HTTParty.get', 'HTTParty.post', 'HTTParty.put', 'HTTParty.delete'],
    
    // Go HTTP Libraries
    go_http: ['http.Get', 'http.Post', 'http.Put', 'http.Delete', 'http.Client'],
    go_resty: ['resty.R().Get', 'resty.R().Post', 'resty.R().Put', 'resty.R().Delete'],
    
    // Rust HTTP Libraries
    rust_reqwest: ['reqwest::get', 'reqwest::post', 'Client::get', 'Client::post'],
    
    // Swift HTTP Libraries
    swift_urlsession: ['URLSession', 'dataTask', 'uploadTask', 'downloadTask'],
    swift_alamofire: ['AF.request', 'Alamofire.request'],
    
    // Generic patterns
    generic: ['httpRequest', 'makeRequest', 'sendRequest', 'apiCall', 'callApi', 'fetchData', 'webRequest', 'httpCall', 'restCall', 'apiRequest']
};

// URL validation patterns
export const URL_PATTERNS = {
    http: /^https?:\/\//i,
    protocol: /^[a-z][a-z0-9+.-]*:/i,
    localhost: /localhost|127\.0\.0\.1|0\.0\.0\.0/i,
    domain: /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i,
    api: /\/(api|v\d+|graphql|rest)/i,
    endpoint: /\.(json|xml|csv|txt)(\?.*)?$/i
};

// HTTP method patterns
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'];

// Security-related patterns
export const SECURITY_PATTERNS = {
    insecure: /^http:\/\//i,
    secure: /^https:\/\//i,
    authHeaders: ['authorization', 'x-api-key', 'x-auth-token', 'bearer'],
    sensitiveParams: ['password', 'token', 'key', 'secret', 'credential', 'auth']
};