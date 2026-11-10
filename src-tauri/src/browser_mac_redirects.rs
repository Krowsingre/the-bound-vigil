// Discover adds policy to WebKit's main-frame navigation while leaving Wry's
// page, download and process callbacks on its original delegate.
use std::cell::{Cell, RefCell};
use std::ffi::c_void;

use block2::Block;
use objc2::rc::{Retained, Weak};
use objc2::runtime::{AnyObject, NSObject, ProtocolObject, Sel};
use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_foundation::NSObjectProtocol;
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate,
    WKNavigationResponse, WKNavigationResponsePolicy, WKNavigationType, WKWebView,
};
use tauri::{AppHandle, Url, Webview};

use super::{tell, view, Event};
use crate::protection::RedirectMode;

type Delegate = ProtocolObject<dyn WKNavigationDelegate>;

struct Policy {
    original: Weak<Delegate>,
    app: AppHandle,
    tab: String,
    provisional: RefCell<Option<Url>>,
    redirected: Cell<bool>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Policy]
    struct RedirectDelegate;

    unsafe impl NSObjectProtocol for RedirectDelegate {
        #[unsafe(method(respondsToSelector:))]
        fn responds_to(&self, selector: Sel) -> bool {
            let own: objc2::runtime::Bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
            own.as_bool() || self.ivars().original.load().is_some_and(|original| original.respondsToSelector(selector))
        }
    }

    impl RedirectDelegate {
        #[unsafe(method_id(forwardingTargetForSelector:))]
        fn forward(&self, selector: Sel) -> Option<Retained<Delegate>> {
            self.ivars().original.load().filter(|original| original.respondsToSelector(selector))
        }
    }

    unsafe impl WKNavigationDelegate for RedirectDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn action(
            &self,
            webview: &WKWebView,
            action: &WKNavigationAction,
            handler: &Block<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            let state = self.ivars();
            let main = unsafe { action.targetFrame() }.is_some_and(|frame| unsafe { frame.isMainFrame() });
            if main {
                let to = unsafe { action.request().URL() }.and_then(|url| parse(&url));
                let explicit = to.as_ref().is_some_and(|to| view::consume_app_navigation(&state.tab, to));
                let from = unsafe { webview.URL() }.and_then(|url| parse(&url));
                if !explicit && unsafe { action.navigationType() } == WKNavigationType::Other {
                    if let (Some(from), Some(to)) = (&from, &to) {
                        if state.refuse(from, to) {
                            handler.call((WKNavigationActionPolicy::Cancel,));
                            return;
                        }
                    }
                }
                state.provisional.replace(to);
                state.redirected.set(false);
            }

            if let Some(original) = state.original.load() {
                unsafe { original.webView_decidePolicyForNavigationAction_decisionHandler(webview, action, handler) };
            } else {
                handler.call((WKNavigationActionPolicy::Cancel,));
            }
        }

        #[unsafe(method(webView:didReceiveServerRedirectForProvisionalNavigation:))]
        fn server_redirect(&self, _webview: &WKWebView, _navigation: Option<&WKNavigation>) {
            self.ivars().redirected.set(true);
        }

        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn response(
            &self,
            webview: &WKWebView,
            response: &WKNavigationResponse,
            handler: &Block<dyn Fn(WKNavigationResponsePolicy)>,
        ) {
            let state = self.ivars();
            if unsafe { response.isForMainFrame() } && state.redirected.replace(false) {
                let from = state.provisional.take();
                let to = unsafe { response.response().URL() }.and_then(|url| parse(&url));
                if let (Some(from), Some(to)) = (from, to) {
                    if state.refuse(&from, &to) {
                        handler.call((WKNavigationResponsePolicy::Cancel,));
                        return;
                    }
                }
            }
            if let Some(original) = state.original.load() {
                unsafe { original.webView_decidePolicyForNavigationResponse_decisionHandler(webview, response, handler) };
            } else {
                handler.call((WKNavigationResponsePolicy::Cancel,));
            }
        }
    }
);

impl Policy {
    fn refuse(&self, from: &Url, to: &Url) -> bool {
        let mut source = from.clone();
        source.set_fragment(None);
        let mut target = to.clone();
        target.set_fragment(None);
        if source == target {
            return false;
        }
        let mode = view::protection().redirect_mode(from.host_str().unwrap_or(""));
        if mode == RedirectMode::Allow {
            return false;
        }
        tell(&self.app, Event::Redirect {
            tab: self.tab.clone(),
            from: from.to_string(),
            url: to.to_string(),
            ask: mode == RedirectMode::Ask,
        });
        true
    }
}

fn parse(url: &objc2_foundation::NSURL) -> Option<Url> {
    super::web_url(&url.absoluteString()?.to_string()).ok()
}

pub(super) fn attach(view: &Webview, app: AppHandle, tab: String) -> tauri::Result<()> {
    view.with_webview(move |platform| {
        let Some(main) = MainThreadMarker::new() else { return };
        // Tauri owns the WKWebView and runs this callback on its main thread.
        let Some(webview) = (unsafe { platform.inner().cast::<WKWebView>().as_ref() }) else { return };
        let Some(original) = (unsafe { webview.navigationDelegate() }) else { return };
        let delegate = main.alloc::<RedirectDelegate>().set_ivars(Policy {
            original: Weak::from_retained(&original),
            app,
            tab,
            provisional: RefCell::new(None),
            redirected: Cell::new(false),
        });
        let delegate: Retained<RedirectDelegate> = unsafe { msg_send![super(delegate), init] };
        static KEY: u8 = 0;
        // WebKit's delegate property is weak. Bind the wrapper's lifetime to
        // the view while leaving ownership of the original with Wry.
        unsafe {
            associate(
                (webview as *const WKWebView).cast_mut().cast(),
                (&KEY as *const u8).cast(),
                Retained::as_ptr(&delegate).cast_mut().cast(),
                1, // OBJC_ASSOCIATION_RETAIN_NONATOMIC
            );
            webview.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        }
    })
}

unsafe extern "C" {
    #[link_name = "objc_setAssociatedObject"]
    fn associate(object: *mut AnyObject, key: *const c_void, value: *mut AnyObject, policy: usize);
}
