package com.autogram.app.features.cloudtransfer.storage;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;

/** Test APK only: issue/revoke narrow grants from the provider's own identity.
 * The DocumentsProvider remains MANAGE_DOCUMENTS protected, just like real SAF storage.
 * No caller path, personal document or arbitrary authority is accepted.
 */
public final class DownloadFixtureControlProvider extends ContentProvider {
    public static final String AUTHORITY = "com.autogram.app.test.downloadcontrol";
    @Override public boolean onCreate() { return true; }
    @Override public Bundle call(String method, String argument, Bundle extras) {
        if (!"com.autogram.app".equals(getCallingPackage()))
            throw new SecurityException("fixture_test_caller_required");
        if (!(method.equals("createFixture") || method.equals("removeFixture") ||
              method.equals("grantFixture") || method.equals("grantPersistableFixture") ||
              method.equals("revokeFixture")))
            throw new IllegalArgumentException("invalid_fixture_control");
        long caller = Binder.clearCallingIdentity();
        try {
            return getContext().getContentResolver().call(
                Uri.parse("content://" + DownloadOutputFixtureProvider.AUTHORITY),
                method, argument, null);
        } finally { Binder.restoreCallingIdentity(caller); }
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] args, String order) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri uri) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
}
