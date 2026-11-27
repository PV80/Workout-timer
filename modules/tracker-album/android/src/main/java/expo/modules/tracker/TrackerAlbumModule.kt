package expo.modules.tracker

import android.content.ContentUris
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore.Images.Media
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class TrackerAlbumModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TrackerAlbum")
    AsyncFunction("saveAsync") { photoId: String, date: String, week: String, day: String, takenAt: Double ->
      save(photoId, date, week, day, takenAt.toLong())
    }
  }

  // The same immutable photo can be retried after an interruption without creating a second copy.
  @Synchronized
  @Suppress("DEPRECATION")
  private fun save(photoId: String, date: String, week: String, day: String, takenAt: Long) {
    require(UUID.fromString(photoId).toString() == photoId)
    require(date.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}")) && week.matches(Regex("W[0-9]{2}")))
    require(day.matches(Regex("[A-Za-z]+")))
    val context = requireNotNull(appContext.reactContext)
    val source = File(context.filesDir, "tracker-pages/$photoId.jpg")
    require(source.isFile && source.length() > 0) { "Choose the tracker photo from your phone again." }

    val resolver = context.contentResolver
    val scoped = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    val album = "Workout Tracker " + date.take(7)
    val name = "${date}_${week}_${day}_$photoId.jpg"
    val relativePath = "${Environment.DIRECTORY_PICTURES}/$album/"
    val locationColumn = if (scoped) Media.RELATIVE_PATH else Media.DATA
    val location = if (scoped) relativePath else {
      val folder = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), album)
      check(folder.isDirectory || folder.mkdirs()) { "Pictures folder is unavailable." }
      File(folder, name).absolutePath
    }
    val images = Media.EXTERNAL_CONTENT_URI
    val projection = if (scoped) arrayOf(Media._ID, Media.IS_PENDING) else arrayOf(Media._ID)
    val existing = resolver.query(images, projection, "${Media.DISPLAY_NAME}=? AND $locationColumn=?",
      arrayOf(name, location), null)?.use { cursor ->
      if (cursor.moveToFirst()) Pair(ContentUris.withAppendedId(images, cursor.getLong(0)), scoped && cursor.getInt(1) == 1)
      else null
    }
    if (existing != null && !existing.second &&
        resolver.openFileDescriptor(existing.first, "r")?.use { it.statSize } == source.length()) return

    val details = ContentValues().apply {
      put(Media.DISPLAY_NAME, name)
      put(Media.MIME_TYPE, "image/jpeg")
      put(Media.DATE_TAKEN, takenAt)
      put(locationColumn, location)
      if (scoped) put(Media.IS_PENDING, 1)
    }
    val uri = existing?.first ?: checkNotNull(resolver.insert(images, details)) { "Cannot create album photo." }
    try {
      checkNotNull(resolver.openOutputStream(uri, "wt")).use { output ->
        source.inputStream().use { it.copyTo(output) }
      }
      if (scoped) {
        val publish = ContentValues().apply { put(Media.IS_PENDING, 0) }
        check(resolver.update(uri, publish, null, null) == 1) { "Cannot publish album photo." }
      }
    } catch (error: Exception) {
      if (existing == null) resolver.delete(uri, null, null)
      throw error
    }
  }
}
