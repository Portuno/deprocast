/**
 * Las páginas públicas (plan v35): lo que Google pide para publicar la conexión OAuth (la página principal y la
 * política de privacidad). Sin datos de nadie: el contacto sale de MASTRO_CONTACTO si está.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const ESTILO = 'body{margin:0;background:#0f1012;color:#e6e6e8;font:16px/1.6 system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:40px 16px}h1{font-size:26px}h2{font-size:18px;margin-top:28px}a{color:#c4a062}p,li{color:#c9cad0}.tenue{color:#9a9ca4;font-size:14px}'

function pagina(titulo: string, cuerpo: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)} · Deprocast</title><style>${ESTILO}</style></head><body><main>${cuerpo}<p class="tenue"><a href="/acerca">Deprocast</a> · <a href="/privacidad">Privacidad</a> · <a href="/entrar">Entrar</a></p></main></body></html>`
}

export function paginaPublica(cual: 'acerca' | 'privacidad'): string {
  const contacto = process.env.MASTRO_CONTACTO?.trim()
  const escribir = contacto ? `<a href="mailto:${esc(contacto)}">${esc(contacto)}</a>` : 'quien administra este Deprocast'
  if (cual === 'acerca') {
    return pagina('Deprocast', `<h1>☿ Deprocast</h1>
<p>Deprocast es un sistema personal: una memoria, un asistente (Mastropiero) y agentes que trabajan para una persona. Cada persona tiene su propio Deprocast, con su base separada de la de cualquier otra.</p>
<p>Se usa por invitación. Si tenés una cuenta, <a href="/entrar">entrá acá</a>.</p>`)
  }
  return pagina('Política de privacidad', `<h1>Política de privacidad</h1>
<p class="tenue">Vigente desde noviembre de 2026.</p>
<h2>Qué es</h2>
<p>Deprocast es un sistema personal. Cada usuario tiene su propio Deprocast, con su propia base de datos: lo de un usuario no lo ve ningún otro.</p>
<h2>Qué datos de Google usa, y para qué</h2>
<p>Solo si el usuario conecta su cuenta de Google, y solo para darle a él estas funciones:</p>
<ul>
<li><b>Gmail</b> (lectura y borradores): ordenar su bandeja, buscar y leer sus mails cuando él lo pide, y dejar borradores de respuesta en su Gmail. Deprocast nunca envía un mail por su cuenta: el borrador lo manda él.</li>
<li><b>Drive y Sheets</b>: buscar sus archivos, leer sus documentos y planillas, y crear o modificar planillas cuando él lo pide.</li>
<li><b>Calendar, contactos y tareas</b>: ver y ordenar su agenda, reconocer a sus contactos y sincronizar sus tareas.</li>
</ul>
<h2>Uso limitado</h2>
<p>El uso que hace Deprocast de la información recibida de las APIs de Google cumple con la <a href="https://developers.google.com/terms/api-services-user-data-policy">Política de datos de usuario de los servicios de API de Google</a>, incluidos los requisitos de uso limitado. Los datos de Google:</p>
<ul>
<li>se usan solo para las funciones que el usuario ve y pide;</li>
<li>no se venden, no se usan para publicidad y no se comparten con terceros;</li>
<li>no se usan para entrenar modelos de inteligencia artificial generales. Para responderle al usuario, un fragmento puede pasar por el modelo de lenguaje que procesa su pedido, sin que ese proveedor lo guarde para entrenar;</li>
<li>no los lee ninguna persona, salvo que el usuario lo pida para resolver un problema, o lo exija la ley.</li>
</ul>
<h2>Dónde se guardan y cómo se borran</h2>
<p>Se guardan en la base del Deprocast del usuario, en un servidor con acceso restringido. El usuario puede desconectar Google cuando quiera (Perfil → Apps conectadas): se revoca el permiso y Deprocast deja de leer. También puede exportar todos sus datos o borrar su cuenta entera, y con ella todo lo guardado.</p>
<h2>Contacto</h2>
<p>Por cualquier consulta sobre tus datos, escribile a ${escribir}.</p>`)
}
