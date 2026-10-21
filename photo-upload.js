
/* DwellHunt Cloudinary Photo Upload */
(() => {
  "use strict";

  const CLOUD = "xx8yy8mw";
  const PRESET = "dwellhunt_properties";
  const API = `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`;
  const MAX_SIZE = 5 * 1024 * 1024;

 
function findPhotoField() {
  const inputs = document.querySelectorAll("input");

  for (const input of inputs) {
    const parent = input.parentElement;
    const grandparent = parent?.parentElement;

    const nearbyText = [
      parent?.textContent || "",
      grandparent?.textContent || ""
    ].join(" ").toLowerCase();

    if (nearbyText.includes("hero photograph url")) {
      return input;
    }
  }

  return null;
}


  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set;

    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function addUploader(input) {
    if (input.dataset.uploaderAdded === "yes") return;
    input.dataset.uploaderAdded = "yes";

    const panel = document.createElement("div");
    panel.style.cssText = `
      margin:12px 0;
      padding:16px;
      border:1px dashed #059669;
      border-radius:12px;
      background:#ecfdf5;
      color:#064e3b;
    `;

    const title = document.createElement("div");
    title.textContent = "Upload Property Photo";
    title.style.cssText = "font-weight:bold;margin-bottom:12px";

    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/jpeg,image/png,image/webp";
    picker.style.cssText = "display:block;width:100%;margin-bottom:12px";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Upload Photo";
    button.style.cssText = `
      background:#047857;
      color:white;
      border:0;
      padding:11px 18px;
      border-radius:8px;
      cursor:pointer;
      font-weight:bold;
    `;

    const status = document.createElement("p");
    status.textContent = "Select a JPG, PNG or WebP photo (max 5 MB).";
    status.style.cssText = "font-size:13px;margin-top:10px";

    const preview = document.createElement("img");
    preview.alt = "Property photo preview";
    preview.style.cssText = `
      display:none;
      width:200px;
      max-width:100%;
      margin-top:12px;
      border-radius:10px;
    `;

    panel.append(title, picker, button, status, preview);
    input.insertAdjacentElement("afterend", panel);

    button.addEventListener("click", async () => {
      const file = picker.files?.[0];

      if (!file) {
        status.textContent = "Please select a photo first.";
        return;
      }

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        status.textContent = "Only JPG, PNG or WebP photos are allowed.";
        return;
      }

      if (file.size > MAX_SIZE) {
        status.textContent = "Photo must be 5 MB or smaller.";
        return;
      }

      button.disabled = true;
      button.textContent = "Uploading...";
      status.textContent = "Uploading to Cloudinary...";

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("upload_preset", PRESET);

        const response = await fetch(API, {
          method: "POST",
          body: form
        });

        const result = await response.json();

        if (!response.ok || !result.secure_url) {
          throw new Error(
            result.error?.message || "Cloudinary upload failed"
          );
        }

        const currentInput = findPhotoField();

        if (!currentInput) {
          throw new Error("Photo field not found. Reopen the form.");
        }

        setReactInput(currentInput, result.secure_url);

        preview.src = result.secure_url;
        preview.style.display = "block";

        status.textContent =
          "Photo uploaded successfully! Continue to publish.";

      } catch (error) {
        status.textContent = "Upload failed: " + error.message;
        console.error("DwellHunt Upload Error:", error);
      } finally {
        button.disabled = false;
        button.textContent = "Upload Photo";
      }
    });
  }

  function scan() {
    const input = findPhotoField();
    if (input) addUploader(input);
  }

  function start() {
    const observer = new MutationObserver(scan);

    observer.observe(
      document.getElementById("root") || document.body,
      { childList: true, subtree: true }
    );

    scan();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
