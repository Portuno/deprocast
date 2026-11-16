package expo.modules.usotelefono

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cuánto tiempo pasó en cada app, cuánto estuvo prendida la pantalla y cuántas veces desbloqueó el teléfono, entre dos
 * instantes. Con el permiso «Acceso a uso» (se da una vez, en los ajustes de Android). Solo tiempos y aperturas: nunca
 * lo que hay adentro de cada app.
 */
class UsoTelefonoModule : Module() {
  private val contexto: Context?
    get() = appContext.reactContext

  private fun tienePermiso(): Boolean {
    val ctx = contexto ?: return false
    val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val modo = if (Build.VERSION.SDK_INT >= 29) {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    } else {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    }
    return modo == AppOpsManager.MODE_ALLOWED
  }

  private fun nombreDe(ctx: Context, paquete: String): String = try {
    val pm = ctx.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(paquete, 0)).toString()
  } catch (_: Exception) {
    paquete
  }

  override fun definition() = ModuleDefinition {
    Name("UsoTelefono")

    Function("tienePermiso") { tienePermiso() }

    // Abre la pantalla de Android donde se da el «Acceso a uso» (directo a esta app si el teléfono lo permite).
    Function("abrirPermiso") {
      val ctx = contexto ?: return@Function false
      val directo = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).setData(Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val general = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try { ctx.startActivity(directo); true } catch (_: Exception) {
        try { ctx.startActivity(general); true } catch (_: Exception) { false }
      }
    }

    // { pantallaMs, desbloqueos, apps: [{ paquete, nombre, ms, aperturas }] } entre desde y hasta (ms), o null sin permiso.
    AsyncFunction("leer") { desdeD: Double, hastaD: Double ->
      val ctx = contexto ?: return@AsyncFunction null
      if (!tienePermiso()) return@AsyncFunction null
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return@AsyncFunction null
      val desde = desdeD.toLong()
      val hasta = hastaD.toLong()
      // Se lee desde 3 horas antes, para saber qué estaba abierto al empezar; el tiempo se recorta a [desde, hasta].
      val eventos = usm.queryEvents(desde - 3 * 3_600_000L, hasta)
      val e = UsageEvents.Event()
      val ms = HashMap<String, Long>()
      val aperturas = HashMap<String, Int>()
      val abiertas = HashMap<String, MutableSet<String>>() // paquete → actividades en primer plano
      var actual: String? = null
      var inicio = 0L
      var ultimoCerrado: String? = null
      var ultimoCierre = 0L
      var pantallaDesde: Long? = null
      var pantallaMs = 0L
      var desbloqueos = 0
      fun sumar(m: HashMap<String, Long>, k: String, a: Long, b: Long) {
        val x = maxOf(a, desde)
        val y = minOf(b, hasta)
        if (y > x) m[k] = (m[k] ?: 0L) + (y - x)
      }
      fun cerrar(t: Long) {
        val p = actual ?: return
        sumar(ms, p, inicio, t)
        ultimoCerrado = p
        ultimoCierre = t
        actual = null
      }
      while (eventos.hasNextEvent()) {
        eventos.getNextEvent(e)
        val t = e.timeStamp
        val p = e.packageName ?: continue
        when (e.eventType) {
          1 -> { // ACTIVITY_RESUMED (MOVE_TO_FOREGROUND)
            abiertas.getOrPut(p) { mutableSetOf() }.add(e.className ?: "")
            if (actual != p) {
              cerrar(t)
              // Volver a la misma app al instante (cambió de pantalla adentro) no es otra apertura.
              val misma = ultimoCerrado == p && t - ultimoCierre < 5_000
              actual = p
              inicio = t
              if (!misma && t >= desde) aperturas[p] = (aperturas[p] ?: 0) + 1
            }
          }
          2, 23 -> { // ACTIVITY_PAUSED, ACTIVITY_STOPPED
            val set = abiertas[p]
            set?.remove(e.className ?: "")
            if (actual == p && (set == null || set.isEmpty())) cerrar(t)
          }
          15 -> if (pantallaDesde == null) pantallaDesde = t // SCREEN_INTERACTIVE
          16 -> { // SCREEN_NON_INTERACTIVE: la pantalla se apagó, nada queda en primer plano
            cerrar(t)
            abiertas.clear()
            val d = pantallaDesde
            if (d != null) {
              val x = maxOf(d, desde)
              val y = minOf(t, hasta)
              if (y > x) pantallaMs += y - x
            }
            pantallaDesde = null
          }
          18 -> if (t >= desde) desbloqueos++ // KEYGUARD_HIDDEN
        }
      }
      cerrar(hasta)
      pantallaDesde?.let { d -> val x = maxOf(d, desde); if (hasta > x) pantallaMs += hasta - x }
      val apps = ms.entries.sortedByDescending { it.value }.take(80).map { (paquete, tiempo) ->
        mapOf("paquete" to paquete, "nombre" to nombreDe(ctx, paquete), "ms" to tiempo.toDouble(), "aperturas" to (aperturas[paquete] ?: 0))
      }
      mapOf("pantallaMs" to pantallaMs.toDouble(), "desbloqueos" to desbloqueos, "apps" to apps)
    }
  }
}
