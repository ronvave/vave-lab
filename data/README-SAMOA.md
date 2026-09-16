# data/samoa-*.json.enc — placeholder stubs

These files are 44-byte, non-decryptable stubs committed only to reserve
the file paths so the dashboard's fetch layer 200s. Every file has the
IVAV magic + zeroed salt/iv/ciphertext and will fail AES-GCM auth on any
decrypt attempt.

The refresh workflow (`.github/workflows/refresh-samoa-master-file.yml`)
overwrites each stub with a real AES-GCM blob (encrypted under
`VAVELAB_SAMOA_PASSCODE`) the first time it runs against a populated
Samoa Master Sheet.

If you see these stubs in a working deploy, the refresh workflow has
never successfully run — check the Actions tab.
