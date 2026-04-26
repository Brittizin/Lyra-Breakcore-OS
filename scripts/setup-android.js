const fs = require("fs");
const path = require("path");

const root = process.cwd();
const androidRoot = path.join(root, "android");
const mainJavaDir = path.join(androidRoot, "app", "src", "main", "java", "com", "brittizin", "lyrabreakcoreos");
const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
const mainActivityPath = path.join(mainJavaDir, "MainActivity.java");
const pluginPath = path.join(mainJavaDir, "LyraMediaScannerPlugin.java");

const mainActivitySource = `package com.brittizin.lyrabreakcoreos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LyraMediaScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;

const pluginSource = `package com.brittizin.lyrabreakcoreos;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(
    name = "LyraMediaScanner",
    permissions = {
        @Permission(
            alias = "audioModern",
            strings = { Manifest.permission.READ_MEDIA_AUDIO }
        ),
        @Permission(
            alias = "audioLegacy",
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE }
        )
    }
)
public class LyraMediaScannerPlugin extends Plugin {

    @PluginMethod
    public void syncDeviceLibrary(PluginCall call) {
        String alias = activeAudioPermissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "permissionCallback");
            return;
        }
        runScan(call);
    }

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState(activeAudioPermissionAlias()) == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState(activeAudioPermissionAlias()) != PermissionState.GRANTED) {
            call.reject("Audio permission denied.");
            return;
        }
        runScan(call);
    }

    private void runScan(PluginCall call) {
        try {
            JSArray songs = new JSArray();
            Set<String> syncedIds = new HashSet<>();
            File audioDir = new File(getContext().getFilesDir(), "device-library/audio");
            File coverDir = new File(getContext().getFilesDir(), "device-library/covers");
            if (!audioDir.exists()) audioDir.mkdirs();
            if (!coverDir.exists()) coverDir.mkdirs();

            Uri collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

            String[] projection = new String[] {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.DATE_MODIFIED,
                MediaStore.Audio.Media.IS_MUSIC
            };

            String selection = MediaStore.Audio.Media.IS_MUSIC + "!=0";
            String[] selectionArgs = null;
            String sortOrder = MediaStore.Audio.Media.DATE_MODIFIED + " DESC";

            ContentResolver resolver = getContext().getContentResolver();
            try (Cursor cursor = resolver.query(collection, projection, selection, selectionArgs, sortOrder)) {
                if (cursor == null) {
                    call.reject("Unable to read MP3 files from the device.");
                    return;
                }

                int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int titleIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int artistIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int albumIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                int mimeIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                int sizeIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                int durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                int modifiedIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED);

                while (cursor.moveToNext()) {
                    try {
                        String displayName = safeText(cursor.getString(nameIndex), "track.mp3");
                        String mimeType = safeText(cursor.getString(mimeIndex), "");
                        if (!isMp3Candidate(displayName, mimeType)) {
                            continue;
                        }

                        long mediaStoreId = cursor.getLong(idIndex);
                        long modifiedSeconds = cursor.getLong(modifiedIndex);
                        long modifiedMs = modifiedSeconds * 1000L;
                        long size = cursor.getLong(sizeIndex);
                        long duration = cursor.getLong(durationIndex);
                        Uri contentUri = ContentUris.withAppendedId(collection, mediaStoreId);

                        String safeTitle = safeText(cursor.getString(titleIndex), fileNameWithoutExt(displayName));
                        String safeArtist = safeText(cursor.getString(artistIndex), "Unknown");
                        String safeAlbum = safeText(cursor.getString(albumIndex), "");
                        String audioFileName = "device-" + mediaStoreId + "-" + modifiedSeconds + extensionFromDisplayName(displayName);
                        File audioFile = new File(audioDir, audioFileName);

                        if (!audioFile.exists() || audioFile.length() != size) {
                            deleteLegacyCopies(audioDir, "device-" + mediaStoreId + "-");
                            copyUriToFile(resolver, contentUri, audioFile);
                        }

                        String coverPath = "";
                        byte[] artBytes = readEmbeddedArt(contentUri);
                        if (artBytes != null && artBytes.length > 0) {
                            String coverExtension = imageExtensionFromBytes(artBytes);
                            File coverFile = new File(coverDir, "device-" + mediaStoreId + "-" + modifiedSeconds + coverExtension);
                            deleteLegacyCopies(coverDir, "device-" + mediaStoreId + "-");
                            writeBytes(coverFile, artBytes);
                            coverPath = coverFile.getAbsolutePath();
                        }

                        int stableId = (int) -mediaStoreId;
                        syncedIds.add(String.valueOf(stableId));

                        JSObject item = new JSObject();
                        item.put("id", stableId);
                        item.put("mediaStoreId", mediaStoreId);
                        item.put("source", "device");
                        item.put("title", safeTitle);
                        item.put("artist", safeArtist);
                        item.put("album", safeAlbum);
                        item.put("filePath", audioFile.getAbsolutePath());
                        item.put("coverPath", coverPath);
                        item.put("duration", duration);
                        item.put("size", size);
                        item.put("addedAt", modifiedMs);
                        item.put("updatedAt", modifiedMs);
                        songs.put(item);
                    } catch (Exception ignored) {
                        // Skip problematic files without aborting the whole library.
                    }
                }
            }

            JSObject result = new JSObject();
            result.put("songs", songs);
            result.put("syncedIds", new JSArray(syncedIds));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to sync the device library.", error);
        }
    }

    private String activeAudioPermissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audioModern" : "audioLegacy";
    }

    private void copyUriToFile(ContentResolver resolver, Uri sourceUri, File targetFile) throws IOException {
        try (InputStream input = resolver.openInputStream(sourceUri); FileOutputStream output = new FileOutputStream(targetFile, false)) {
            if (input == null) throw new IOException("Unavailable file stream.");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
        }
    }

    private byte[] readEmbeddedArt(Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(getContext(), uri);
            return retriever.getEmbeddedPicture();
        } catch (Exception ignored) {
            return null;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
                // noop
            }
        }
    }

    private void writeBytes(File targetFile, byte[] bytes) throws IOException {
        try (FileOutputStream output = new FileOutputStream(targetFile, false)) {
            output.write(bytes);
            output.flush();
        }
    }

    private void deleteLegacyCopies(File directory, String prefix) {
        File[] matches = directory.listFiles((dir, name) -> name.startsWith(prefix));
        if (matches == null) return;
        for (File file : matches) {
            if (!file.delete()) {
                file.deleteOnExit();
            }
        }
    }

    private String safeText(String value, String fallback) {
        if (value == null) return fallback;
        String trimmed = value.trim();
        return trimmed.isEmpty() || "<unknown>".equalsIgnoreCase(trimmed) ? fallback : trimmed;
    }

    private String fileNameWithoutExt(String value) {
        if (value == null || value.trim().isEmpty()) return "Local Track";
        int dotIndex = value.lastIndexOf('.');
        return dotIndex > 0 ? value.substring(0, dotIndex) : value;
    }

    private String extensionFromDisplayName(String name) {
        if (name == null) return ".mp3";
        int dotIndex = name.lastIndexOf('.');
        if (dotIndex >= 0 && dotIndex < name.length() - 1) {
            return name.substring(dotIndex).toLowerCase(Locale.ROOT);
        }
        return ".mp3";
    }

    private boolean isMp3Candidate(String displayName, String mimeType) {
        String lowerName = displayName == null ? "" : displayName.toLowerCase(Locale.ROOT);
        String lowerMime = mimeType == null ? "" : mimeType.toLowerCase(Locale.ROOT);
        return lowerName.endsWith(".mp3") ||
            lowerMime.equals("audio/mpeg") ||
            lowerMime.equals("audio/mp3") ||
            lowerMime.equals("audio/x-mpeg") ||
            lowerMime.equals("audio/x-mp3");
    }

    private String imageExtensionFromBytes(@NonNull byte[] bytes) {
        if (bytes.length >= 8 &&
            bytes[0] == (byte) 0x89 &&
            bytes[1] == 0x50 &&
            bytes[2] == 0x4E &&
            bytes[3] == 0x47) {
            return ".png";
        }
        if (bytes.length >= 3 &&
            bytes[0] == (byte) 0xFF &&
            bytes[1] == (byte) 0xD8 &&
            bytes[2] == (byte) 0xFF) {
            return ".jpg";
        }
        if (bytes.length >= 4 &&
            bytes[0] == 0x47 &&
            bytes[1] == 0x49 &&
            bytes[2] == 0x46) {
            return ".gif";
        }
        if (bytes.length >= 12 &&
            bytes[0] == 0x52 &&
            bytes[1] == 0x49 &&
            bytes[2] == 0x46 &&
            bytes[3] == 0x46 &&
            bytes[8] == 0x57 &&
            bytes[9] == 0x45 &&
            bytes[10] == 0x42 &&
            bytes[11] == 0x50) {
            return ".webp";
        }
        return ".jpg";
    }
}
`;

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function patchManifest(contents) {
  let next = contents;
  if (!next.includes('android.permission.READ_MEDIA_AUDIO')) {
    next = next.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />'
    );
  }
  return next;
}

function main() {
  if (!fs.existsSync(androidRoot)) {
    throw new Error("android directory not found. Run `npx cap add android` first.");
  }

  ensureDir(mainJavaDir);
  fs.writeFileSync(mainActivityPath, mainActivitySource, "utf8");
  fs.writeFileSync(pluginPath, pluginSource, "utf8");

  const manifest = fs.readFileSync(manifestPath, "utf8");
  fs.writeFileSync(manifestPath, patchManifest(manifest), "utf8");

  console.log("Android setup complete.");
}

main();