Public test-only self-signed TLS fixture for public.example. This private key is
deliberately committed for the isolated HTTPS test server and has no external use.
Only the test transport trusts this certificate; production trust is unchanged.

Generated with OpenSSL:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 36500 -subj '/CN=public.example' -addext 'subjectAltName=DNS:public.example'
```
