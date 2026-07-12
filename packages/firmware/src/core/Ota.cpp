#ifndef NATIVE_BUILD

#include "Ota.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "Log.h"
#include "Version.h"

namespace botforge {

namespace {

// Default latest.json location. CI attaches latest.json + firmware.bin to
// GitHub Releases on tags (PLAN Phase 2.7); override per-robot via the
// optional "ota_url" config key or at build time with -DBOTFORGE_OTA_URL.
#ifndef BOTFORGE_OTA_URL
#define BOTFORGE_OTA_URL \
  "https://github.com/botforge-robotics/botforge/releases/latest/download/latest.json"
#endif

bool s_uploadOk = false;
char s_lastError[64] = {0};

void setError(const char* msg) {
  strncpy(s_lastError, msg != nullptr ? msg : "", sizeof(s_lastError) - 1);
  s_lastError[sizeof(s_lastError) - 1] = '\0';
}

/// Stream `http`'s body into Update.h. Returns true when flashed.
bool flashFromStream(HTTPClient& http) {
  int len = http.getSize();
  if (!Update.begin(len > 0 ? static_cast<size_t>(len)
                            : UPDATE_SIZE_UNKNOWN)) {
    logf(LOG_ERROR, "ota: Update.begin failed: %s", Update.errorString());
    return false;
  }
  size_t written = Update.writeStream(http.getStream());
  if (len > 0 && written != static_cast<size_t>(len)) {
    logf(LOG_ERROR, "ota: short write (%u/%d)", static_cast<unsigned>(written),
         len);
    Update.abort();
    return false;
  }
  if (!Update.end(true)) {
    logf(LOG_ERROR, "ota: Update.end failed: %s", Update.errorString());
    return false;
  }
  return true;
}

}  // namespace

void Ota::handleUploadChunk(WebServer& server) {
  HTTPUpload& upload = server.upload();
  switch (upload.status) {
    case UPLOAD_FILE_START:
      s_uploadOk = false;
      setError("");
      logf(LOG_INFO, "ota: upload start (%s)", upload.filename.c_str());
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
        setError(Update.errorString());
        logf(LOG_ERROR, "ota: begin failed: %s", s_lastError);
      }
      break;
    case UPLOAD_FILE_WRITE:
      if (!Update.hasError()) {
        if (Update.write(upload.buf, upload.currentSize) !=
            upload.currentSize) {
          setError(Update.errorString());
        }
      }
      break;
    case UPLOAD_FILE_END:
      if (!Update.hasError() && Update.end(true)) {
        s_uploadOk = true;
        logf(LOG_INFO, "ota: upload complete (%u bytes), reboot to apply",
             static_cast<unsigned>(upload.totalSize));
      } else {
        setError(Update.errorString());
        logf(LOG_ERROR, "ota: end failed: %s", s_lastError);
      }
      break;
    case UPLOAD_FILE_ABORTED:
      Update.abort();
      setError("upload aborted");
      logf(LOG_WARN, "ota: upload aborted");
      break;
  }
}

bool Ota::uploadOk() { return s_uploadOk; }

const char* Ota::lastError() { return s_lastError; }

void Ota::checkOnBoot(Config& config) {
  if (!config.otaCheckOnBoot()) return;
  if (WiFi.status() != WL_CONNECTED) {
    logf(LOG_WARN, "ota: check skipped (no wifi)");
    return;
  }
  const char* url = config.otaUrl();
  if (url[0] == '\0') url = BOTFORGE_OTA_URL;
  logf(LOG_INFO, "ota: checking %s", url);

  // GitHub requires TLS; pinning the CA chain across cert rotations is not
  // worth it for an opt-in hobby update channel, so accept any cert here.
  // POST /api/ota on the LAN remains the primary update path.
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(10000);
  if (!http.begin(client, url)) {
    logf(LOG_WARN, "ota: bad url");
    return;
  }
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    logf(LOG_WARN, "ota: latest.json fetch failed (%d)", code);
    http.end();
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  const char* version = doc["version"] | "";
  const char* binUrl = doc["url"] | "";
  if (err != DeserializationError::Ok || version[0] == '\0' ||
      binUrl[0] == '\0') {
    logf(LOG_WARN, "ota: latest.json malformed");
    return;
  }
  if (!versionLess(BOTFORGE_FW_VERSION, version)) {
    logf(LOG_INFO, "ota: up to date (%s)", BOTFORGE_FW_VERSION);
    return;
  }

  logf(LOG_INFO, "ota: updating %s -> %s", BOTFORGE_FW_VERSION, version);
  WiFiClientSecure binClient;
  binClient.setInsecure();
  HTTPClient binHttp;
  binHttp.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  binHttp.setTimeout(15000);
  if (!binHttp.begin(binClient, binUrl)) {
    logf(LOG_WARN, "ota: bad firmware url");
    return;
  }
  int binCode = binHttp.GET();
  if (binCode != HTTP_CODE_OK) {
    logf(LOG_WARN, "ota: firmware fetch failed (%d)", binCode);
    binHttp.end();
    return;
  }
  bool ok = flashFromStream(binHttp);
  binHttp.end();
  if (ok) {
    logf(LOG_INFO, "ota: flashed %s, rebooting", version);
    delay(500);
    ESP.restart();
  }
}

}  // namespace botforge

#endif  // NATIVE_BUILD
