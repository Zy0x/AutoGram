package com.autogram.app.preview;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Test APK process has only platform dependencies, not the target app's Kotlin runtime. */
public final class PreviewFixtureProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        if ("note".equals(uri.getLastPathSegment())) return "text/plain";
        if ("tone".equals(uri.getLastPathSegment())) return "audio/wav";
        throw new IllegalArgumentException("unknown_fixture");
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) {
        getType(uri);
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME});
        cursor.addRow(new Object[]{uri.getLastPathSegment()});
        return cursor;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("read_only");
        byte[] bytes = "text/plain".equals(getType(uri))
            ? "Actual provider content — UTF-8".getBytes(StandardCharsets.UTF_8) : tone();
        // Never use the URI as a path or expose user files. Each request owns this fixture.
        File file = new File(getContext().getCacheDir(), "preview-test-" + UUID.randomUUID());
        try {
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (IOException error) {
            throw new FileNotFoundException("fixture_unavailable");
        } finally {
            // Android keeps an opened descriptor readable after unlinking its test fixture.
            file.delete();
        }
    }

    private byte[] tone() {
        int samples = 24000;
        ByteBuffer bytes = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        bytes.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + samples * 2);
        bytes.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
        bytes.putInt(16).putShort((short) 1).putShort((short) 1).putInt(8000).putInt(16000);
        bytes.putShort((short) 2).putShort((short) 16);
        bytes.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples * 2);
        for (int i = 0; i < samples; i++) {
            bytes.putShort((short) (Math.sin(i * 2 * Math.PI * 220 / 8000) * 1000));
        }
        return bytes.array();
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
