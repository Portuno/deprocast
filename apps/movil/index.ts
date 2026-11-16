import { registerRootComponent } from 'expo';
// La tarea de fondo del recorrido tiene que estar definida apenas arranca (Android la despierta con la app cerrada).
import './src/recorrido';
// Lo mismo la de los pasos (Mobile 1.3): Android la despierta cada ~15 minutos para leer el contador del teléfono.
import './src/pasos';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
