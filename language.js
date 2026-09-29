/* =========================================================
   BHUMI AI LANGUAGE SYSTEM
   English = source language
   Marathi = Gemini generated + cached
   No manual data-i18n required
   ========================================================= */

(() => {
  const STORAGE_LANG = "bhumiLanguage";
  const STORAGE_SELECTED = "bhumiLanguageSelected";

  // v2 = fresh cache so old incorrect translations are not reused
  const CACHE_PREFIX = "bhumiAITranslation:v2:";

  const API_URL = "http://localhost:3000/api/translate";

  let currentLanguage =
    localStorage.getItem(STORAGE_LANG) || "en";

  let translating = false;
  let observer = null;

  /*
    Original English content is permanently remembered
    so English <-> Marathi can switch without refresh.
  */
  const originalText = new WeakMap();
  const trackedTextNodes = new Set();

  const originalAttrs = new WeakMap();
  const trackedElements = new Set();

  /*
    New/dynamic elements waiting for translation.
  */
  const pendingTargets = new Set();

  /*
    Language UI text.
  */
  const ui = {
    en: {
      choose: "Choose Language",
      select: "Select your language",
      english: "English",
      marathi: "मराठी",
      about: "About BHUMI",
      close: "Close",
      translating: "Translating...",
      translateError:
        "Translation could not be loaded. Please try again."
    },

    mr: {
      choose: "भाषा निवडा",
      select: "तुमची भाषा निवडा",
      english: "English",
      marathi: "मराठी",
      about: "BHUMI बद्दल",
      close: "बंद करा",
      translating: "भाषांतर सुरू आहे...",
      translateError:
        "भाषांतर लोड झाले नाही. पुन्हा प्रयत्न करा."
    }
  };


  /* =========================================================
     BASIC HELPERS
     ========================================================= */

  function shouldSkipElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }

    if (
      [
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "SVG"
      ].includes(element.tagName)
    ) {
      return true;
    }

    if (
      element.closest(
        "[data-bhumi-no-translate], .language-popup, .language-switcher"
      )
    ) {
      return true;
    }

    return false;
  }


  function isUsefulString(value) {
    if (value == null) return false;

    const text = String(value).trim();

    if (!text) return false;

    /*
      Ignore extremely tiny punctuation-only strings.
      Numbers are intentionally allowed.
    */
    if (text.length < 1) return false;

    /*
      Never send URLs or email addresses to Gemini.
    */
    if (/^(https?:\/\/|mailto:|tel:)/i.test(text)) {
      return false;
    }

    if (
      /^[^\p{L}\p{N}]+$/u.test(text)
    ) {
      return false;
    }

    return true;
  }


  function protectBHUMI(text) {
    if (!text) return text;

    /*
      AI sometimes changes BHUMI into भूमि / भूमी.
      Always restore the brand name.
    */
    return text
      .replace(/भूमि/gi, "BHUMI")
      .replace(/भूमी/gi, "BHUMI")
      .replace(/भुमी/gi, "BHUMI");
  }


  /* =========================================================
     TEXT NODE HANDLING
     ========================================================= */

  function isTranslatableTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return false;
    }

    const text = node.nodeValue?.trim();

    if (!isUsefulString(text)) {
      return false;
    }

    const parent = node.parentElement;

    if (!parent) {
      return false;
    }

    if (shouldSkipElement(parent)) {
      return false;
    }

    /*
      Do not translate input values.
      Placeholder is handled separately.
    */
    if (
      parent.tagName === "INPUT" &&
      parent.type !== "button" &&
      parent.type !== "submit"
    ) {
      return false;
    }

    return true;
  }


  function rememberTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return;
    }

    if (!originalText.has(node)) {
      originalText.set(node, node.nodeValue);
    }

    trackedTextNodes.add(node);
  }


  function collectTextNodes(root = document.body) {
    const nodes = [];

    if (!root) return nodes;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );

    let node;

    while ((node = walker.nextNode())) {
      if (isTranslatableTextNode(node)) {
        rememberTextNode(node);
        nodes.push(node);
      }
    }

    return nodes;
  }


  /* =========================================================
     ATTRIBUTE HANDLING
     ========================================================= */

  const TRANSLATABLE_ATTRIBUTES = [
    "placeholder",
    "title",
    "aria-label",
    "alt"
  ];


  function rememberAttribute(element, attr) {
    if (!element || !element.hasAttribute(attr)) {
      return;
    }

    if (!originalAttrs.has(element)) {
      originalAttrs.set(element, {});
    }

    const attrs = originalAttrs.get(element);

    if (!(attr in attrs)) {
      attrs[attr] = element.getAttribute(attr);
    }

    trackedElements.add(element);
  }


  function collectAttributes(root = document.body) {
    const elements = [];

    if (!root) return elements;

    let allElements = [];

    if (root.nodeType === Node.ELEMENT_NODE) {
      allElements.push(root);
    }

    allElements.push(
      ...root.querySelectorAll("*")
    );

    for (const element of allElements) {
      if (shouldSkipElement(element)) {
        continue;
      }

      for (const attr of TRANSLATABLE_ATTRIBUTES) {
        if (!element.hasAttribute(attr)) {
          continue;
        }

        const value =
          element.getAttribute(attr);

        if (!isUsefulString(value)) {
          continue;
        }

        rememberAttribute(element, attr);

        elements.push({
          element,
          attr
        });
      }
    }

    return elements;
  }


  /* =========================================================
     TARGET COLLECTION
     ========================================================= */

  function collectTargets(root = document.body) {
    const targets = [];

    const textNodes =
      collectTextNodes(root);

    textNodes.forEach(node => {
      targets.push({
        type: "text",
        node
      });
    });


    const attributes =
      collectAttributes(root);

    attributes.forEach(item => {
      targets.push({
        type: "attr",
        element: item.element,
        attr: item.attr
      });
    });

    return targets;
  }


  function getTargetSource(target) {
    if (!target) return "";

    if (target.type === "text") {
      if (!target.node) return "";

      /*
        Always use original English text.
      */
      return (
        originalText.get(target.node) ||
        target.node.nodeValue ||
        ""
      ).trim();
    }

    if (target.type === "attr") {
      const attrs =
        originalAttrs.get(target.element);

      if (!attrs) return "";

      return (
        attrs[target.attr] ||
        ""
      ).trim();
    }

    return "";
  }


  /* =========================================================
     CACHE
     ========================================================= */

  function cacheKey(text) {
    return (
      CACHE_PREFIX +
      encodeURIComponent(text)
    );
  }


  function getCached(text) {
    try {
      return localStorage.getItem(
        cacheKey(text)
      );
    } catch {
      return null;
    }
  }


  function setCached(text, value) {
    try {
      localStorage.setItem(
        cacheKey(text),
        value
      );
    } catch {
      // Ignore localStorage errors
    }
  }


  /* =========================================================
     GEMINI API
     ========================================================= */

  async function requestTranslations(texts) {
    const response = await fetch(
      API_URL,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          language: "Marathi",
          texts
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Translation API ${response.status}`
      );
    }

    const data =
      await response.json();

    if (
      !Array.isArray(data.translations) ||
      data.translations.length !== texts.length
    ) {
      throw new Error(
        "Invalid translation response"
      );
    }

    return data.translations;
  }


  /* =========================================================
     APPLY TRANSLATION
     ========================================================= */

  function applyTranslation(target) {
    if (!target) return;

    const source =
      getTargetSource(target);

    if (!source) return;

    /*
      BHUMI should NEVER be translated.
    */
    if (
      source.trim().toUpperCase() === "BHUMI"
    ) {
      if (target.type === "text") {
        if (target.node) {
          target.node.nodeValue = "BHUMI";
        }
      }

      if (target.type === "attr") {
        target.element.setAttribute(
          target.attr,
          "BHUMI"
        );
      }

      return;
    }


    const translated =
      getCached(source);

    if (!translated) {
      return;
    }

    const safeTranslation =
      protectBHUMI(translated);


    if (
      target.type === "text" &&
      target.node
    ) {
      target.node.nodeValue =
        safeTranslation;
    }


    if (
      target.type === "attr" &&
      target.element
    ) {
      target.element.setAttribute(
        target.attr,
        safeTranslation
      );
    }
  }


  /* =========================================================
     QUEUE SYSTEM
     ========================================================= */

  function queueTargets(targets) {
    if (!Array.isArray(targets)) {
      return;
    }

    targets.forEach(target => {
      if (target) {
        pendingTargets.add(target);
      }
    });

    processQueue();
  }


  async function processQueue() {
    if (translating) {
      return;
    }

    if (currentLanguage !== "mr") {
      return;
    }

    if (!pendingTargets.size) {
      return;
    }

    translating = true;

    try {
      while (
        pendingTargets.size &&
        currentLanguage === "mr"
      ) {
        /*
          Take everything currently waiting.
        */
        const targets =
          Array.from(pendingTargets);

        pendingTargets.clear();


        /*
          Group targets by original English source.
        */
        const sourceMap =
          new Map();

        for (const target of targets) {
          const source =
            getTargetSource(target);

          if (!source) continue;

          /*
            BHUMI does not need API translation.
          */
          if (
            source.trim().toUpperCase() ===
            "BHUMI"
          ) {
            applyTranslation(target);
            continue;
          }

          if (!sourceMap.has(source)) {
            sourceMap.set(
              source,
              []
            );
          }

          sourceMap
            .get(source)
            .push(target);
        }


        /*
          Find texts which are not cached.
        */
        const uncached = [];

        for (const source of sourceMap.keys()) {
          if (!getCached(source)) {
            uncached.push(source);
          }
        }


        /*
          Gemini batches of 25.
        */
        for (
          let i = 0;
          i < uncached.length;
          i += 25
        ) {
          const batch =
            uncached.slice(
              i,
              i + 25
            );

          try {
            const translated =
              await requestTranslations(
                batch
              );

            batch.forEach(
              (source, index) => {
                let value =
                  translated[index];

                if (
                  typeof value !== "string"
                ) {
                  value = source;
                }

                value =
                  protectBHUMI(
                    value
                  );

                setCached(
                  source,
                  value
                );
              }
            );
          } catch (error) {
            console.error(
              "BHUMI translation batch error:",
              error
            );

            /*
              Continue remaining batches
              instead of breaking the whole system.
            */
          }
        }


        /*
          Apply translations only if user
          is still on Marathi.
        */
        if (currentLanguage === "mr") {
          for (const target of targets) {
            applyTranslation(target);
          }
        }

        /*
          If Database / another page created
          new DOM during the API call,
          MutationObserver has already placed
          those targets into pendingTargets.
          The while loop will process them.
        */
      }

    } catch (error) {
      console.error(
        "BHUMI translation error:",
        error
      );

      showToast(
        ui.mr.translateError
      );

    } finally {
      translating = false;

      /*
        One final check in case something
        arrived immediately before finishing.
      */
      if (
        currentLanguage === "mr" &&
        pendingTargets.size
      ) {
        processQueue();
      }
    }
  }


  /* =========================================================
     RESTORE ENGLISH
     ========================================================= */

  function restoreEnglish() {
    /*
      Restore every text node we have ever tracked.
      This works even if the current text is Marathi.
    */
    trackedTextNodes.forEach(node => {
      const source =
        originalText.get(node);

      if (
        source != null &&
        node.isConnected
      ) {
        node.nodeValue = source;
      }
    });


    /*
      Restore placeholders, titles,
      aria-labels and alt text.
    */
    trackedElements.forEach(
      element => {
        const attrs =
          originalAttrs.get(element);

        if (!attrs) return;

        Object.entries(attrs)
          .forEach(
            ([attr, value]) => {
              if (
                element.isConnected &&
                value != null
              ) {
                element.setAttribute(
                  attr,
                  value
                );
              }
            }
          );
      }
    );


    /*
      Clear anything waiting for Marathi.
    */
    pendingTargets.clear();

    updateLanguageLabel();
    syncUI();
  }


  /* =========================================================
     LANGUAGE UI
     ========================================================= */

  function updateLanguageLabel() {
    const label =
      currentLanguage === "mr"
        ? "मराठी"
        : "English";

    document
      .querySelectorAll(
        ".language-switcher [data-bhumi-current-language]"
      )
      .forEach(element => {
        element.textContent = label;
      });
  }


  function syncUI() {
    updateLanguageLabel();


    document
      .querySelectorAll(
        "#bhumi-language-menu button, .mobile-topbar .language-menu button"
      )
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.bhumiLang ===
            currentLanguage
        );
      });


    const title =
      document.getElementById(
        "bhumi-language-title"
      );

    const subtitle =
      document.getElementById(
        "bhumi-language-subtitle"
      );


    if (title) {
      title.textContent =
        ui[currentLanguage].choose;
    }

    if (subtitle) {
      subtitle.textContent =
        ui[currentLanguage].select;
    }
  }


  function showToast(message) {
    let toast =
      document.getElementById(
        "bhumi-language-toast"
      );

    if (!toast) {
      toast =
        document.createElement("div");

      toast.id =
        "bhumi-language-toast";

      toast.className =
        "bhumi-language-toast";

      document.body.appendChild(
        toast
      );
    }

    toast.textContent = message;

    toast.classList.add("show");

    setTimeout(() => {
      toast.classList.remove(
        "show"
      );
    }, 3000);
  }

  function injectLanguageUI() {
  if (document.getElementById("bhumi-language-ui")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "bhumi-language-ui";

  wrapper.innerHTML = `
    <div class="language-switcher" data-bhumi-no-translate>

      <button
        class="language-current"
        id="bhumi-language-current"
        type="button"
        aria-expanded="false"
      >
        🌐 <span data-bhumi-current-language>English</span>
      </button>

      <div class="language-menu" id="bhumi-language-menu">

        <button type="button" data-bhumi-lang="en">
          🇬🇧 English
        </button>

        <button type="button" data-bhumi-lang="mr">
          🇮🇳 मराठी
        </button>

      </div>
    </div>

    <div
      class="language-popup"
      id="bhumi-language-popup"
      data-bhumi-no-translate
    >

      <div class="language-popup-card">

        <button
          class="language-popup-close"
          id="bhumi-language-close"
          type="button"
        >
          ×
        </button>

        <div class="language-popup-icon">🌿</div>

        <h2 id="bhumi-language-title">
          Choose Language
        </h2>

        <p id="bhumi-language-subtitle">
          Select your language
        </p>

        <button
          class="language-option"
          data-bhumi-lang="en"
          type="button"
        >
          🇬🇧 English
        </button>

        <button
          class="language-option"
          data-bhumi-lang="mr"
          type="button"
        >
          🇮🇳 मराठी
        </button>

      </div>
    </div>
  `;

  document.body.appendChild(wrapper);

  /* ---------- DESKTOP SWITCHER ---------- */

  const desktopNav =
    document.querySelector(".nav-links");

  const desktopSwitcher =
    wrapper.querySelector(".language-switcher");

  if (desktopNav && desktopSwitcher) {
    desktopNav.appendChild(desktopSwitcher);
  }

  /* ---------- MOBILE SWITCHER ---------- */

  const topbar =
    document.querySelector(".mobile-topbar");

  if (topbar && desktopSwitcher) {

    const mobileSwitcher =
      desktopSwitcher.cloneNode(true);

    mobileSwitcher.removeAttribute("id");

    const mobileCurrent =
      mobileSwitcher.querySelector(
        ".language-current"
      );

    const mobileMenu =
      mobileSwitcher.querySelector(
        ".language-menu"
      );

    if (mobileCurrent) {
      mobileCurrent.removeAttribute("id");
    }

    if (mobileMenu) {
      mobileMenu.removeAttribute("id");
    }

    topbar.appendChild(mobileSwitcher);
  }

  /* ---------- LANGUAGE BUTTON CLICK ---------- */

  document
    .querySelectorAll(".language-current")
    .forEach(current => {

      current.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          const menu =
            current.parentElement
              ?.querySelector(
                ".language-menu"
              );

          if (menu) {
            menu.classList.toggle("show");
          }

        }
      );

    });

  /* ---------- LANGUAGE OPTIONS ---------- */

  document
    .querySelectorAll("[data-bhumi-lang]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          selectLanguage(
            button.dataset.bhumiLang
          );

        }
      );

    });

  /* ---------- POPUP CLOSE ---------- */

  const closeButton =
    document.getElementById(
      "bhumi-language-close"
    );

  if (closeButton) {
    closeButton.addEventListener(
      "click",
      hidePopup
    );
  }
}

  function showPopup() {
    const popup =
      document.getElementById(
        "bhumi-language-popup"
      );

    if (popup) {
      popup.classList.add("show");

      document.body.classList.add(
        "language-popup-open"
      );
    }
  }


  function hidePopup() {
    const popup =
      document.getElementById(
        "bhumi-language-popup"
      );

    if (popup) {
      popup.classList.remove(
        "show"
      );

      document.body.classList.remove(
        "language-popup-open"
      );
    }
  }


  /* =========================================================
     LANGUAGE SELECTION
     ========================================================= */

  async function selectLanguage(language) {
    if (
      !["en", "mr"].includes(language)
    ) {
      return;
    }

    currentLanguage = language;

    localStorage.setItem(
      STORAGE_LANG,
      language
    );

    localStorage.setItem(
      STORAGE_SELECTED,
      "true"
    );

    document.documentElement.lang =
      language;


    updateLanguageLabel();
    syncUI();


    /*
      Close language menus.
    */
    document
      .querySelectorAll(
        ".language-menu"
      )
      .forEach(menu => {
        menu.classList.remove(
          "show"
        );
      });


    hidePopup();


    /* ---------- ENGLISH ---------- */

    if (language === "en") {
      restoreEnglish();
      return;
    }


    /* ---------- MARATHI ---------- */

    /*
      Re-scan complete page.

      This is important for Database page
      because crop cards are created AFTER
      the initial page load.
    */
    const targets =
      collectTargets(
        document.body
      );


    queueTargets(targets);

    showToast(
      ui.mr.translating
    );
  }


  /* =========================================================
     MUTATION OBSERVER
     ========================================================= */

  function startObserver() {
    if (observer) {
      observer.disconnect();
    }


    observer =
      new MutationObserver(
        mutations => {

          const targets = [];


          mutations.forEach(
            mutation => {

              mutation.addedNodes.forEach(
                node => {

                  /*
                    Newly added text node.
                  */
                  if (
                    node.nodeType ===
                    Node.TEXT_NODE
                  ) {
                    if (
                      isTranslatableTextNode(
                        node
                      )
                    ) {
                      rememberTextNode(
                        node
                      );

                      targets.push({
                        type: "text",
                        node
                      });
                    }

                    return;
                  }


                  /*
                    Newly added element.
                  */
                  if (
                    node.nodeType ===
                    Node.ELEMENT_NODE
                  ) {

                    /*
                      Always remember
                      English originals.
                    */
                    const childTargets =
                      collectTargets(
                        node
                      );

                    targets.push(
                      ...childTargets
                    );
                  }

                }
              );

            }
          );


          /*
            If Marathi is active,
            translate immediately.

            If English is active,
            we only track originals.
          */
          if (
            currentLanguage === "mr" &&
            targets.length
          ) {
            queueTargets(
              targets
            );
          }

        }
      );


    if (!document.body) {
      return;
    }


    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }


  /* =========================================================
     EXISTING LANGUAGE BUTTON EVENTS
     ========================================================= */

  function setupLanguageButtons() {

    /*
      Existing language switcher.
      No new UI is injected.
    */

    document
      .querySelectorAll(
        ".language-current"
      )
      .forEach(current => {

        /*
          Prevent duplicate listeners.
        */
        if (
          current.dataset
            .bhumiLanguageBound ===
          "true"
        ) {
          return;
        }

        current.dataset
          .bhumiLanguageBound =
          "true";


        current.addEventListener(
          "click",
          event => {

            event.stopPropagation();

            const menu =
              current.parentElement
                ?.querySelector(
                  ".language-menu"
                );

            if (menu) {
              menu.classList.toggle(
                "show"
              );
            }

          }
        );

      });


    document
      .querySelectorAll(
        "[data-bhumi-lang]"
      )
      .forEach(button => {

        if (
          button.dataset
            .bhumiLanguageBound ===
          "true"
        ) {
          return;
        }

        button.dataset
          .bhumiLanguageBound =
          "true";


        button.addEventListener(
          "click",
          () => {

            selectLanguage(
              button.dataset
                .bhumiLang
            );

          }
        );

      });


    const closeButton =
      document.getElementById(
        "bhumi-language-close"
      );


    if (
      closeButton &&
      closeButton.dataset
        .bhumiLanguageBound !==
        "true"
    ) {

      closeButton.dataset
        .bhumiLanguageBound =
        "true";

      closeButton.addEventListener(
        "click",
        hidePopup
      );

    }
  }


  /* =========================================================
     INITIALIZATION
     ========================================================= */

  document.addEventListener(
    "DOMContentLoaded",
    async () => {

      /*
        IMPORTANT:
        We do NOT call injectLanguageUI().

        Your existing HTML already contains
        the language UI.
      */
      injectLanguageUI();

      startObserver();


      /*
        Track all original English content
        before any translation happens.
      */
      const initialTargets =
        collectTargets(
          document.body
        );


      /*
        Restore/sync current language.
      */
      document.documentElement.lang =
        currentLanguage;

      syncUI();


      /* ---------- MARATHI ---------- */

      if (
        currentLanguage === "mr"
      ) {

        queueTargets(
          initialTargets
        );

      }


      /* ---------- FIRST VISIT ---------- */

      else if (
        !localStorage.getItem(
          STORAGE_SELECTED
        )
      ) {

        setTimeout(
          showPopup,
          400
        );

      }

    }
  );


  /* =========================================================
     GLOBAL API
     ========================================================= */

  window.BHUMILanguage = {
    selectLanguage,
    showPopup,
    hidePopup
  };

})();