package expo.modules.contadorpasos

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * El contador de pasos de hardware (TYPE_STEP_COUNTER): el teléfono cuenta solo, todo el día, aunque la app esté cerrada,
 * y da el total desde que se prendió. La librería de pasos de Expo resta el valor del arranque de la suscripción (solo
 * cuenta lo de mientras escucha); acá se lee el total crudo, una vez, y la app suma la diferencia con la lectura anterior.
 */
class ContadorPasosModule : Module() {
  private val sensores: SensorManager?
    get() = appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

  override fun definition() = ModuleDefinition {
    Name("ContadorPasos")

    Function("disponible") {
      sensores?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
    }

    // Devuelve { total, arranque, en } o null (sin sensor, sin permiso o sin respuesta en 4 s).
    AsyncFunction("leer") { promise: Promise ->
      val sm = sensores
      val sensor = sm?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
      if (sm == null || sensor == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val principal = Handler(Looper.getMainLooper())
      var listo = false
      lateinit var oyente: SensorEventListener
      val terminar = { valor: Any? ->
        if (!listo) {
          listo = true
          try { sm.unregisterListener(oyente) } catch (_: Exception) {}
          promise.resolve(valor)
        }
      }
      oyente = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
          val ahora = System.currentTimeMillis()
          principal.post {
            terminar(mapOf(
              "total" to e.values[0].toDouble(),
              "arranque" to (ahora - SystemClock.elapsedRealtime()).toDouble(),
              "en" to ahora.toDouble()
            ))
          }
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
      }
      try {
        if (!sm.registerListener(oyente, sensor, SensorManager.SENSOR_DELAY_NORMAL, 0, principal)) {
          terminar(null)
          return@AsyncFunction
        }
      } catch (_: SecurityException) {
        terminar(null) // sin el permiso de actividad física
        return@AsyncFunction
      }
      principal.postDelayed({ terminar(null) }, 4000)
    }
  }
}
