package expo.modules.widgethoy

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Lo que la app le pasa al widget: se guarda y se redibujan todos los widgets puestos en la pantalla de inicio. */
class WidgetHoyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetHoy")

    Function("actualizar") { titulo: String, sub: String, validar: Int ->
      val ctx = appContext.reactContext ?: return@Function false
      ctx.getSharedPreferences(WidgetHoyProvider.PREFS, android.content.Context.MODE_PRIVATE).edit()
        .putString("titulo", titulo)
        .putString("sub", sub)
        .putInt("validar", validar)
        .putLong("en", System.currentTimeMillis())
        .apply()
      WidgetHoyProvider.redibujarTodos(ctx)
      true
    }
  }
}
