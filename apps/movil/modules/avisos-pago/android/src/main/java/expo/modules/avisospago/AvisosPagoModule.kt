package expo.modules.avisospago

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/** El lado de la app de los avisos de pago (Fragua #296): el permiso, la lista de apps y la cola guardada. */
class AvisosPagoModule : Module() {
  private val contexto: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("AvisosPago")

    Function("tienePermiso") {
      val ctx = contexto ?: return@Function false
      val habilitados = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: ""
      val yo = ComponentName(ctx, AvisosPagoListener::class.java).flattenToString()
      habilitados.split(":").any { it == yo || it.startsWith("${ctx.packageName}/") }
    }

    Function("abrirPermiso") {
      val ctx = contexto ?: return@Function false
      try { ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
    }

    // Las apps de pago y banco que escucha (además de las que se reconocen por el nombre).
    Function("fijarPaquetes") { paquetes: List<String> ->
      val ctx = contexto ?: return@Function false
      ctx.getSharedPreferences(AvisosPagoListener.PREFS, Context.MODE_PRIVATE).edit().putStringSet(AvisosPagoListener.PAQUETES, paquetes.toSet()).apply()
      true
    }

    // Lo que espera ser mandado (sin sacarlo: se saca con soltar, cuando el servidor lo recibió).
    Function("pendientes") {
      val ctx = contexto ?: return@Function emptyList<Map<String, Any?>>()
      val c = AvisosPagoListener.cola(ctx)
      (0 until c.length()).mapNotNull { i -> c.optJSONObject(i)?.let { x: JSONObject -> mapOf("paquete" to x.optString("paquete"), "app" to x.optString("app"), "titulo" to x.optString("titulo"), "texto" to x.optString("texto"), "en" to x.optDouble("en")) } }
    }

    // Saca de la cola lo que ya llegó al servidor (hasta ese instante, inclusive).
    Function("soltar") { hasta: Double ->
      val ctx = contexto ?: return@Function 0
      val c = AvisosPagoListener.cola(ctx)
      val queda = org.json.JSONArray()
      for (i in 0 until c.length()) { val x = c.optJSONObject(i) ?: continue; if (x.optDouble("en") > hasta) queda.put(x) }
      AvisosPagoListener.guardarCola(ctx, queda)
      c.length() - queda.length()
    }
  }
}
