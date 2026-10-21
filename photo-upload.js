
(() => {
  "use strict";

  const CLOUD_NAME = "xx8yy8mw";
  const UPLOAD_PRESET = "dwellhunt_properties";
  const UPLOAD_URL =
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;

  const MAX_SIZE = 5 * 1024 * 1024;

  function findPhotoField() {
    const inputs = [...document.querySelectorAll('input')];

    return inputs.find(input => {
      const placeholder = (input.placeholder || "").toLowerCase();
      const label = input.closest("div")?.parentElement?.innerText
        ?.toLowerCase() || "";

      return (
        placeholder.includes("image url") ||
        placeholder.includes("photo url") ||
        placeholder.includes("photo by url") ||
        (input.type === "url" && /photo|image/.test(label))
      );
    });
  }

  function updateReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function createUploader(input) {
    if (input.dataset.dhUploadAttached) return;

    input.dataset.dhUploadAttached = "true";

    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      margin: 12px 0;
      padding: 18px;
      border: 2px dashed #059669;
      border-radius: 14px;
      background: #ecfdf5;
      font-family: Arial, sans-serif;
    `;

    wrapper.innerHTML = `
      <div style="font-weight:700;margin-bottom:10px;color:#065f46">
        Upload Property Photo
      </div>

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style="width:100%;margin-bottom:12px"
      />

      <button type="button" style="
        background:#047857;
        color:white;
        border:0;
        border-radius:8px;
        padding:11px 18px;
        cursor:pointer;
        font-weight:700;
      ">
        Upload Photo
      </button>

      <p class="dh-upload-status"
         style="font-size:13px;margin-top:10px">
        Select a JPG, PNG or WebP photo (max 5 MB).
      </p>

      <img class="dh-upload-preview"
           alt="Property photo preview"
           style="
             display:none;
             width:100%;
             max-width:260px;
             margin-top:12px;
             border-radius:10px;
           "/>
    `;

    input.insertAdjacentElement("afterend", wrapper);

    const fileInput = wrapper.querySelector('input[type="file"]');
    const button = wrapper.querySelector("button");
    const status = wrapper.querySelector(".dh-upload-status");
    const preview = wrapper.querySelector(".dh-upload-preview");

    button.addEventListener("click", async () => {
      const file = fileInput.files?.[0];

      if (!file) {
        status.textContent = "Please select a photo first.";
        return;
      }

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        status.textContent = "Only JPG, PNG and WebP are allowed.";
        return;
      }

      if (file.size > MAX_SIZE) {
        status.textContent = "Photo must be smaller than 5 MB.";
        return;
      }

      button.disabled = true;
      button.textContent = "Uploading...";
      status.textContent = "Uploading photo to Cloudinary...";

      try {
        const data = new FormData();
        data.append("file", file);
        data.append("upload_preset", UPLOAD_PRESET);

        const response = await fetch(UPLOAD_URL, {
          method: "POST",
          body: data
        });

        const result = await response.json();

        if (!response.ok || !result.secure_url) {
          throw new Error(
            result.error?.message || "Cloudinary upload failed"
          );
        }

        updateReactInput(input, result.secure_url);

        preview.src = result.secure_url;
        preview.style.display = "block";

        status.textContent =
          "Photo uploaded successfully! Image URL added to form.";

      } catch (error) {
        status.textContent = "Upload failed: " + error.message;
        console.error("DwellHunt Cloudinary:", error);
      } finally {
        button.disabled = false;
        button.textContent = "Upload Photo";
      }
    });
  }

  function initializeUploader() {
    const input = findPhotoField();

    if (input) {
      createUploader(input);
    }
  }

  const observer = new MutationObserver(initializeUploader);

  function start() {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    initializeUploader();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
