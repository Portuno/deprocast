package expo.modules.atajodictado

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * El icono rápido «Dictar a Deprocast» (Fragua #300): se agrega una vez desde la barra de notificaciones (lápiz → arrastrar)
 * y un toque abre Deprocast en Hoy con la escucha prendida, lista para hablar. Abre la app por su link
 * (deprocast://dictar); lo demás lo hace la app.
 */
class AtajoDictadoTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.let { it.state = Tile.STATE_INACTIVE; it.updateTile() }
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  override fun onClick() {
    super.onClick()
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("deprocast://dictar"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val abrir = {
      if (Build.VERSION.SDK_INT >= 34) {
        startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(intent)
      }
    }
    // Con el teléfono bloqueado, primero se desbloquea.
    if (isLocked) unlockAndRun { abrir() } else abrir()
  }
}
