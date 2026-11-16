package expo.modules.atajodictado

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Para ofrecer el icono rápido desde la app (Android 13+: un cartel del sistema que lo agrega con un toque). */
class AtajoDictadoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AtajoDictado")

    Function("puedeOfrecer") { Build.VERSION.SDK_INT >= 33 }

    // Pide al sistema agregar el icono a la barra (Android 13+). Devuelve si se pudo pedir.
    Function("ofrecer") {
      val ctx = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < 33) return@Function false
      try {
        val sbm = ctx.getSystemService(StatusBarManager::class.java) ?: return@Function false
        sbm.requestAddTileService(
          ComponentName(ctx, AtajoDictadoTile::class.java),
          "Dictar a Deprocast",
          Icon.createWithResource(ctx, android.R.drawable.ic_btn_speak_now),
          ctx.mainExecutor
        ) { _ -> }
        true
      } catch (_: Exception) {
        false
      }
    }
  }
}
