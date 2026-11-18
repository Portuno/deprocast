package expo.modules.widgethoy

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/**
 * El widget «Deprocast · Ahora»: lo de ahora y lo que espera tu ok, con lo último que le pasó la app (no pide nada
 * solo: así no gasta batería ni red). Tocarlo abre Hoy; «Dictar» abre la escucha lista para hablar; «Validar», la tanda.
 */
class WidgetHoyProvider : AppWidgetProvider() {
  companion object {
    const val PREFS = "deprocast_widget_hoy"

    fun redibujarTodos(ctx: Context) {
      val am = AppWidgetManager.getInstance(ctx)
      val ids = am.getAppWidgetIds(ComponentName(ctx, WidgetHoyProvider::class.java))
      for (id in ids) am.updateAppWidget(id, vista(ctx))
    }

    /** Abre la app por su link (deprocast://…): lo demás lo hace la app. */
    private fun abrir(ctx: Context, link: String, codigo: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(ctx.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      return PendingIntent.getActivity(ctx, codigo, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun vista(ctx: Context): RemoteViews {
      val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val titulo = p.getString("titulo", null) ?: "Abrí Deprocast una vez"
      val sub = p.getString("sub", null) ?: "Así el widget sabe qué mostrar."
      val validar = p.getInt("validar", 0)
      val v = RemoteViews(ctx.packageName, R.layout.widget_hoy)
      v.setTextViewText(R.id.widget_hoy_titulo, titulo)
      v.setTextViewText(R.id.widget_hoy_sub, sub)
      v.setViewVisibility(R.id.widget_hoy_sub, if (sub.isBlank()) View.GONE else View.VISIBLE)
      v.setTextViewText(R.id.widget_hoy_validar, if (validar > 0) "Validar · $validar" else "Validar")
      v.setOnClickPendingIntent(R.id.widget_hoy_raiz, abrir(ctx, "deprocast://hoy", 1))
      v.setOnClickPendingIntent(R.id.widget_hoy_dictar, abrir(ctx, "deprocast://dictar", 2))
      v.setOnClickPendingIntent(R.id.widget_hoy_validar, abrir(ctx, "deprocast://validar", 3))
      return v
    }
  }

  override fun onUpdate(ctx: Context, am: AppWidgetManager, ids: IntArray) {
    for (id in ids) am.updateAppWidget(id, vista(ctx))
  }
}
