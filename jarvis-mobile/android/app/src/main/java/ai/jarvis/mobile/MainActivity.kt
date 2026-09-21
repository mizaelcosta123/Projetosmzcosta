package ai.jarvis.mobile

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * A window onto the Jarvis server.
 *
 * The interface is already a web app served by the server itself, so this app
 * is deliberately thin: it exists to give the face a launcher icon, its own
 * task in the recents list, and a window with no browser chrome around it. It
 * holds no logic of its own — everything it shows comes from the server, which
 * means updating the interface never means shipping a new APK.
 *
 * The address is configurable because where the server runs is the one thing
 * that genuinely varies: Termux on this phone, a machine on the same Wi-Fi, or
 * something hosted.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var offline: LinearLayout
    private lateinit var offlineBody: TextView

    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private var address: String
        get() = prefs.getString(KEY_ADDRESS, DEFAULT_ADDRESS) ?: DEFAULT_ADDRESS
        set(value) = prefs.edit().putString(KEY_ADDRESS, value).apply()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#04060B"))
            settings.apply {
                // The interface is ES modules and a canvas; without this it is
                // a blank screen.
                javaScriptEnabled = true
                // localStorage holds the server address and the voice
                // preference. Off by default on a WebView.
                domStorageEnabled = true
                // The face speaks the moment a reply lands, with no tap in
                // between — treating that as a user gesture is the whole point.
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                loadWithOverviewMode = true
                useWideViewPort = true
            }
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError,
                ) {
                    // Only the top-level load failing means "no server". A
                    // missing sub-resource is not worth hiding the whole page.
                    if (request.isForMainFrame) showOffline()
                }

                override fun onPageFinished(view: WebView, url: String) {
                    offline.visibility = View.GONE
                    web.visibility = View.VISIBLE
                }
            }
        }

        offline = buildOfflinePanel()

        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(
                    web,
                    LinearLayout.LayoutParams(MATCH, 0).apply { weight = 1f },
                )
                addView(offline, LinearLayout.LayoutParams(MATCH, MATCH))
            }
        )

        // The web app has its own history; the system back button should walk
        // that before leaving the app.
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (web.canGoBack()) web.goBack() else finish()
                }
            },
        )

        load()
    }

    private fun load() {
        offline.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(address)
    }

    private fun showOffline() {
        web.visibility = View.GONE
        offlineBody.text = getString(R.string.offline_body, address)
        offline.visibility = View.VISIBLE
    }

    private fun buildOfflinePanel(): LinearLayout {
        val pad = (24 * resources.displayMetrics.density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#04060B"))
            visibility = View.GONE

            addView(
                TextView(context).apply {
                    setText(R.string.offline_title)
                    setTextColor(Color.parseColor("#E8EFF8"))
                    textSize = 19f
                    gravity = Gravity.CENTER
                }
            )
            offlineBody = TextView(context).apply {
                setTextColor(Color.parseColor("#6C7D95"))
                textSize = 14f
                gravity = Gravity.CENTER
                setPadding(0, pad / 2, 0, pad)
            }
            addView(offlineBody)
            addView(
                Button(context).apply {
                    setText(R.string.retry)
                    setOnClickListener { load() }
                }
            )
            addView(
                Button(context).apply {
                    setText(R.string.change_address)
                    setOnClickListener { promptForAddress() }
                }
            )
        }
    }

    private fun promptForAddress() {
        val input = EditText(this).apply {
            setText(address)
            setHint(R.string.address_hint)
            setSingleLine()
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.change_address)
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val typed = input.text.toString().trim()
                if (typed.isNotEmpty()) {
                    // A bare host is almost always meant as http; requiring the
                    // scheme would just produce a confusing failure.
                    address = if (typed.startsWith("http")) typed else "http://$typed"
                    load()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val PREFS = "jarvis"
        const val KEY_ADDRESS = "address"

        /** Termux on this same phone — the setup this app is built around. */
        const val DEFAULT_ADDRESS = "http://127.0.0.1:8000"

        const val MATCH = LinearLayout.LayoutParams.MATCH_PARENT
    }
}
