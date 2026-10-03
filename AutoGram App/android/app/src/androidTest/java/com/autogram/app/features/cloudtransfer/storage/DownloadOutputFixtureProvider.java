package com.autogram.app.features.cloudtransfer.storage;

import android.content.Intent;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.Bundle;
import android.os.Binder;
import android.os.Process;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Test APK provider has platform/Java dependencies only. It never opens caller paths. */
public final class DownloadOutputFixtureProvider extends DocumentsProvider {
    public static final String AUTHORITY = "com.autogram.app.test.downloadoutput";
    private final ConcurrentHashMap<String, Fixture> fixtures = new ConcurrentHashMap<>();

    private static final class Fixture {
        final File file;
        final String behavior;
        boolean written;
        boolean transformed;
        Fixture(File file, String behavior) { this.file = file; this.behavior = behavior; }
    }

    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String argument, Bundle extras) {
        // Instrumentation runs with the target UID, even when using the test APK's Context.
        // Grant/revoke therefore execute here in the actual provider-owned process.
        if (Binder.getCallingUid() != Process.myUid() && !"com.autogram.app".equals(getCallingPackage()))
            throw new SecurityException("fixture_test_caller_required");
        if ("createFixture".equals(method)) {
            if (argument == null || !(argument.equals("normal") || argument.equals("short") ||
                argument.equals("corrupt") || argument.equals("unreadable") ||
                argument.equals("revoked") || argument.equals("nonempty")))
                throw new IllegalArgumentException("invalid_fixture_behavior");
            String id = UUID.randomUUID().toString();
            File file = new File(getContext().getCacheDir(), "download-output-fixture-" + id);
            try {
                if (!file.createNewFile()) throw new IOException("fixture_collision");
                if (argument.equals("nonempty")) {
                    try (RandomAccessFile bytes = new RandomAccessFile(file, "rw")) { bytes.write(42); }
                }
            } catch (IOException failure) { throw new IllegalStateException("fixture_unavailable"); }
            fixtures.put(id, new Fixture(file, argument));
            Bundle result = new Bundle();
            result.putString("id", id);
            return result;
        }
        if ("removeFixture".equals(method)) {
            Fixture fixture = fixtures.remove(argument);
            if (fixture != null && fixture.file.exists() && !fixture.file.delete())
                throw new IllegalStateException("fixture_cleanup_failed");
            return Bundle.EMPTY;
        }
        if ("grantFixture".equals(method) || "grantPersistableFixture".equals(method) ||
            "revokeFixture".equals(method)) {
            if (!fixtures.containsKey(argument)) throw new IllegalArgumentException("unknown_fixture");
            Uri uri = DocumentsContract.buildDocumentUri(AUTHORITY, argument);
            int access = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            if ("revokeFixture".equals(method)) getContext().revokeUriPermission(uri, access);
            else {
                if ("grantPersistableFixture".equals(method)) access |= Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;
                getContext().grantUriPermission("com.autogram.app", uri, access);
            }
            return Bundle.EMPTY;
        }
        return super.call(method, argument, extras);
    }

    @Override public ParcelFileDescriptor openDocument(String id, String mode, CancellationSignal signal)
            throws FileNotFoundException {
        if (signal != null) signal.throwIfCanceled();
        Fixture fixture = requireFixture(id);
        synchronized (fixture) {
            if (mode.equals("wa")) {
                fixture.written = true;
                return ParcelFileDescriptor.open(fixture.file,
                    ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_APPEND);
            }
            if (!mode.equals("r")) throw new FileNotFoundException("unsupported_fixture_mode");
            if (fixture.written) {
                if (fixture.behavior.equals("revoked")) throw new SecurityException("fixture_revoked");
                if (fixture.behavior.equals("unreadable")) throw new FileNotFoundException("fixture_unreadable");
                if (!fixture.transformed && (fixture.behavior.equals("short") || fixture.behavior.equals("corrupt"))) {
                    try (RandomAccessFile bytes = new RandomAccessFile(fixture.file, "rw")) {
                        if (fixture.behavior.equals("short")) bytes.setLength(Math.max(0, bytes.length() - 1));
                        else if (bytes.length() > 0) {
                            int first = bytes.read();
                            bytes.seek(0);
                            bytes.write(first ^ 1);
                        }
                    } catch (IOException failure) { throw new FileNotFoundException("fixture_transform_failed"); }
                    fixture.transformed = true;
                }
            }
            return ParcelFileDescriptor.open(fixture.file, ParcelFileDescriptor.MODE_READ_ONLY);
        }
    }

    @Override public Cursor queryDocument(String id, String[] projection) throws FileNotFoundException {
        requireFixture(id);
        MatrixCursor cursor = new MatrixCursor(new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS
        });
        cursor.addRow(new Object[] {id, "synthetic.bin", "application/octet-stream",
            DocumentsContract.Document.FLAG_SUPPORTS_WRITE});
        return cursor;
    }

    @Override public Cursor queryRoots(String[] projection) {
        // Fixtures are never exposed as a user's browsable storage root.
        return new MatrixCursor(new String[] {DocumentsContract.Root.COLUMN_ROOT_ID});
    }

    @Override public Cursor queryChildDocuments(String parent, String[] projection, String sort)
            throws FileNotFoundException { throw new FileNotFoundException("no_fixture_tree"); }

    private Fixture requireFixture(String id) throws FileNotFoundException {
        Fixture fixture = fixtures.get(id);
        if (fixture == null) throw new FileNotFoundException("unknown_fixture");
        return fixture;
    }
}
