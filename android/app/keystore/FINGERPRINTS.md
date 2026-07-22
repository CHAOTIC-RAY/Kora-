# Kora CI signing keystore (sideload / GitHub Releases)

Used by `.github/workflows/android-apk.yml` when upload-key secrets are not set.

| Field | Value |
|-------|-------|
| File | `kora-ci.jks` |
| Alias | `kora` |
| Validity | until 2053-12-07 |

## Certificate fingerprints

```
SHA-1:   CB:DC:CE:55:45:4E:3E:48:D4:EE:1B:DD:CA:9A:66:F0:FE:80:D1:E9
SHA-256: 3D:A6:99:30:8F:3A:81:37:9B:AD:63:BE:59:2E:CC:34:1B:77:3D:0D:96:8B:E7:A2:50:7C:7C:46:A7:65:57:07
```

For Play Store production builds, set repository secrets instead:

- `KORA_UPLOAD_KEYSTORE_BASE64`
- `KORA_UPLOAD_STORE_PASSWORD`
- `KORA_UPLOAD_KEY_ALIAS`
- `KORA_UPLOAD_KEY_PASSWORD`
