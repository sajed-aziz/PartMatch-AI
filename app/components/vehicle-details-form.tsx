"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";

type VehicleForm = {
  customerName: string;
  model: string;
  year: string;
  vin: string;
  side: string;
};

type FormErrors = Partial<Record<keyof VehicleForm | "photo", string>>;

type SavedRequest = {
  requestId: string;
  vehicle: VehicleForm;
  photoName: string;
};

type SubmissionResponse = {
  request?: {
    id: string;
    status: string;
    createdAt: string;
  };
  error?: string;
};

const initialForm: VehicleForm = {
  customerName: "",
  model: "",
  year: "",
  vin: "",
  side: "",
};

const supportedYears = Array.from({ length: 8 }, (_, index) => String(2014 - index));
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
const acceptedPhotoTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
];
const acceptedPhotoExtension = /\.(jpe?g|png|webp|heic|heif|avif)$/i;
const previewablePhotoTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const maximumPhotoSize = 10 * 1024 * 1024;

const headlightSides = [
  { value: "Left (driver side)", label: "Left", description: "Driver side" },
  { value: "Right (passenger side)", label: "Right", description: "Passenger side" },
  { value: "Not sure", label: "Not sure", description: "Seller will confirm" },
] as const;

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="1.8">
      <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="2">
      <path d="m5 10.5 3.1 3L15 6.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 fill-none stroke-current" strokeWidth="1.8">
      <path d="M12 16V5m0 0L8 9m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 14.5v3.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V14.5" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7">
      <rect x="4.5" y="8.2" width="11" height="8" rx="2" />
      <path d="M7 8.2V6.5a3 3 0 0 1 6 0v1.7" />
    </svg>
  );
}

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VehicleDetailsForm() {
  const [form, setForm] = useState<VehicleForm>(initialForm);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [savedRequest, setSavedRequest] = useState<SavedRequest | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function updateField(field: keyof VehicleForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSavedRequest(null);
    setSubmitError(null);
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function handleVinChange(value: string) {
    const normalizedVin = value.toUpperCase().replace(/\s/g, "").slice(0, 17);
    updateField("vin", normalizedVin);
  }

  function selectPhoto(selectedPhoto: File) {
    setSavedRequest(null);
    setSubmitError(null);

    if (
      !acceptedPhotoTypes.includes(selectedPhoto.type) &&
      !acceptedPhotoExtension.test(selectedPhoto.name)
    ) {
      setPhoto(null);
      setPhotoPreview(null);
      setErrors((current) => ({
        ...current,
        photo: "Choose a JPG, PNG, WebP, HEIC, HEIF, or AVIF image.",
      }));
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    if (selectedPhoto.size > maximumPhotoSize) {
      setPhoto(null);
      setPhotoPreview(null);
      setErrors((current) => ({ ...current, photo: "Choose an image smaller than 10 MB." }));
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    setPhoto(selectedPhoto);
    setErrors((current) => ({ ...current, photo: undefined }));

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(selectedPhoto);
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedPhoto = event.target.files?.[0];
    if (selectedPhoto) selectPhoto(selectedPhoto);
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  function handlePhotoDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingPhoto(false);
    const droppedPhoto = event.dataTransfer.files?.[0];
    if (droppedPhoto) selectPhoto(droppedPhoto);
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreview(null);
    setSavedRequest(null);
    setSubmitError(null);
    setErrors((current) => ({ ...current, photo: undefined }));
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FormErrors = {};

    if (form.customerName.trim().length < 2) {
      nextErrors.customerName = "Enter the customer’s full name.";
    }

    if (!form.model) {
      nextErrors.model = "Select your vehicle model.";
    }

    if (!form.year) {
      nextErrors.year = "Select the vehicle year.";
    }

    if (form.vin && !vinPattern.test(form.vin)) {
      nextErrors.vin = "Enter a valid 17-character VIN without I, O, or Q.";
    }

    if (!form.side) {
      nextErrors.side = "Select the headlight side, or choose Not sure.";
    }

    if (!photo) {
      nextErrors.photo = "Choose a clear headlight photo.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0 && photo) {
      setIsSubmitting(true);
      setSubmitError(null);
      setSavedRequest(null);

      const normalizedVehicle = {
        ...form,
        customerName: form.customerName.trim(),
      };
      const requestData = new FormData();

      requestData.set("customerName", normalizedVehicle.customerName);
      requestData.set("model", normalizedVehicle.model);
      requestData.set("year", normalizedVehicle.year);
      requestData.set("vin", normalizedVehicle.vin);
      requestData.set("side", normalizedVehicle.side);
      requestData.set("photo", photo);

      try {
        const response = await fetch("/api/requests", {
          method: "POST",
          body: requestData,
        });
        const result = (await response.json()) as SubmissionResponse;

        if (!response.ok || !result.request) {
          throw new Error(result.error || "The request could not be submitted.");
        }

        setSavedRequest({
          requestId: result.request.id,
          vehicle: normalizedVehicle,
          photoName: photo.name,
        });
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "The request could not be submitted. Please try again.",
        );
      } finally {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dfe3e9] bg-white shadow-[0_8px_30px_rgba(24,32,51,0.055)]">
      <div className="flex flex-col gap-3 border-b border-[#e8eaee] px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-7">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-[#182033]">Request details</h2>
          <p className="mt-1.5 text-sm text-[#737d8d]">Provide the information a seller needs to identify the correct headlight.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-[#707a8b]">
          <span className="size-1.5 rounded-full bg-[#536ee8]" />
          Manual request
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="px-6 py-7 sm:px-8 sm:py-9">
        <div className="grid min-w-0 gap-x-5 gap-y-6 sm:grid-cols-2">
          <div className="flex items-end justify-between border-b border-[#eceef1] pb-4 sm:col-span-2">
            <div>
              <h3 className="text-sm font-semibold text-[#293142]">Customer and vehicle</h3>
              <p className="mt-1 text-xs text-[#89919e]">Your contact name and vehicle identification.</p>
            </div>
            <span className="text-xs font-medium text-[#9aa1ad]">01</span>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="customer-name" className="mb-2 block text-[13px] font-medium text-[#344054]">
              Customer full name <span className="text-[#d45b5b]">*</span>
            </label>
            <input
              id="customer-name"
              name="customerName"
              type="text"
              value={form.customerName}
              onChange={(event) => updateField("customerName", event.target.value)}
              autoComplete="name"
              placeholder="Enter your full name"
              aria-invalid={Boolean(errors.customerName)}
              aria-describedby={errors.customerName ? "customer-name-error" : "customer-name-help"}
              className={`h-12 w-full rounded-[10px] border bg-white px-3.5 text-sm text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition placeholder:text-[#a2a9b5] focus:ring-3 ${
                errors.customerName
                  ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                  : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
              }`}
            />
            {errors.customerName ? (
              <p id="customer-name-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.customerName}
              </p>
            ) : (
              <p id="customer-name-help" className="mt-2 text-xs text-[#858e9d]">
                This name will identify your request to the participating seller.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="vehicle-model" className="mb-2 block text-[13px] font-medium text-[#344054]">
              Vehicle model <span className="text-[#d45b5b]">*</span>
            </label>
            <div className="relative">
              <select
                id="vehicle-model"
                name="model"
                value={form.model}
                onChange={(event) => updateField("model", event.target.value)}
                aria-invalid={Boolean(errors.model)}
                aria-describedby={errors.model ? "model-error" : "model-help"}
                className={`h-12 w-full appearance-none rounded-[10px] border bg-white px-3.5 pr-11 text-sm text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition focus:ring-3 ${
                  errors.model
                    ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                    : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
                }`}
              >
                <option value="" disabled>
                  Select a model
                </option>
                <option value="Mercedes-Benz C-Class (W204)">Mercedes-Benz C-Class (W204)</option>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[#7d8695]">
                <ChevronDownIcon />
              </span>
            </div>
            {errors.model ? (
              <p id="model-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.model}
              </p>
            ) : (
              <p id="model-help" className="mt-2 text-xs text-[#858e9d]">
                The current pilot supports the Mercedes-Benz C-Class W204.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="vehicle-year" className="mb-2 block text-[13px] font-medium text-[#344054]">
              Year <span className="text-[#d45b5b]">*</span>
            </label>
            <div className="relative">
              <select
                id="vehicle-year"
                name="year"
                value={form.year}
                onChange={(event) => updateField("year", event.target.value)}
                aria-invalid={Boolean(errors.year)}
                aria-describedby={errors.year ? "year-error" : undefined}
                className={`h-12 w-full appearance-none rounded-[10px] border bg-white px-3.5 pr-11 text-sm text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition focus:ring-3 ${
                  errors.year
                    ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                    : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
                }`}
              >
                <option value="" disabled>
                  Select year
                </option>
                {supportedYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[#7d8695]">
                <ChevronDownIcon />
              </span>
            </div>
            {errors.year ? (
              <p id="year-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.year}
              </p>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="vehicle-vin" className="block text-[13px] font-medium text-[#344054]">
                VIN
              </label>
              <span className="text-xs font-normal text-[#8b93a1]">
                Optional
              </span>
            </div>
            <input
              id="vehicle-vin"
              name="vin"
              type="text"
              value={form.vin}
              onChange={(event) => handleVinChange(event.target.value)}
              maxLength={17}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. WDDGF4HB0CA123456"
              aria-invalid={Boolean(errors.vin)}
              aria-describedby={errors.vin ? "vin-error" : "vin-help"}
              className={`h-12 w-full rounded-[10px] border bg-white px-3.5 font-mono text-sm uppercase tracking-[0.04em] text-[#273142] shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-[#a2a9b5] focus:ring-3 ${
                errors.vin
                  ? "border-[#d45b5b] focus:border-[#d45b5b] focus:ring-[#d45b5b]/10"
                  : "border-[#cfd5dd] hover:border-[#b8c0cc] focus:border-[#536ee8] focus:ring-[#536ee8]/10"
              }`}
            />
            {errors.vin ? (
              <p id="vin-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.vin}
              </p>
            ) : (
              <div id="vin-help" className="mt-2 flex items-center justify-between gap-3 text-xs text-[#858e9d]">
                <span>17 characters; I, O and Q are not used.</span>
                <span aria-label={`${form.vin.length} of 17 characters`}>{form.vin.length}/17</span>
              </div>
            )}
          </div>

          <div className="mt-2 flex items-end justify-between border-b border-[#eceef1] pb-4 pt-5 sm:col-span-2">
            <div>
              <h3 className="text-sm font-semibold text-[#293142]">Headlight information</h3>
              <p className="mt-1 text-xs text-[#89919e]">Select the damaged side and attach one clear photo.</p>
            </div>
            <span className="text-xs font-medium text-[#9aa1ad]">02</span>
          </div>

          <fieldset className="sm:col-span-2" aria-describedby={errors.side ? "side-error" : "side-help"}>
            <legend className="mb-2.5 text-[13px] font-medium text-[#344054]">
              Headlight side <span className="text-[#d45b5b]">*</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {headlightSides.map((side) => (
                <label
                  key={side.value}
                  className={`relative cursor-pointer rounded-[10px] border px-4 py-3.5 transition ${
                    form.side === side.value
                      ? "border-[#536ee8] bg-[#f5f6ff] shadow-[0_0_0_3px_rgba(83,110,232,0.08)]"
                      : "border-[#cfd5dd] bg-white hover:border-[#aeb7c5] hover:bg-[#fafbfc]"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="side"
                      value={side.value}
                      checked={form.side === side.value}
                      onChange={(event) => updateField("side", event.target.value)}
                      className="size-4 accent-[#536ee8]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-[#30394a]">{side.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[#89919e]">{side.description}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {errors.side ? (
              <p id="side-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.side}
              </p>
            ) : (
              <p id="side-help" className="mt-2 text-xs text-[#858e9d]">
                Choose &quot;Not sure&quot; if the photo does not make the side clear.
              </p>
            )}
          </fieldset>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="headlight-photo" className="block text-[13px] font-medium text-[#344054]">
                Headlight photo <span className="text-[#d45b5b]">*</span>
              </label>
              <span className="text-xs text-[#8b93a1]">Maximum 10 MB</span>
            </div>
            <div className="relative">
              <input
                ref={photoInputRef}
                id="headlight-photo"
                name="photo"
                type="file"
                accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif"
                onChange={handlePhotoChange}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDraggingPhoto(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDraggingPhoto(false)}
                onDrop={handlePhotoDrop}
                aria-invalid={Boolean(errors.photo)}
                aria-describedby={errors.photo ? "photo-error" : "photo-help"}
                className={
                  photo
                    ? "peer sr-only"
                    : "peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                }
              />
              <div
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDraggingPhoto(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDraggingPhoto(false)}
              onDrop={handlePhotoDrop}
              className={`min-h-36 rounded-xl border border-dashed p-4 transition peer-focus-visible:outline-none peer-focus-visible:ring-3 peer-focus-visible:ring-[#536ee8]/10 ${
                errors.photo
                  ? "border-[#d45b5b] bg-[#fffafa]"
                  : isDraggingPhoto
                    ? "border-[#536ee8] bg-[#f3f5ff]"
                    : photo
                      ? "border-[#78ae9d] bg-[#f6fbf9]"
                      : "border-[#c7cdd6] bg-[#fafbfc] hover:border-[#8797c8] hover:bg-[#f8f9fc]"
              }`}
              >
              {photo ? (
                <div className="flex min-h-28 flex-col gap-4 sm:flex-row sm:items-center">
                  {photoPreview && previewablePhotoTypes.has(photo.type) ? (
                    <div
                      role="img"
                      aria-label={`Preview of ${photo.name}`}
                      className="h-28 w-full shrink-0 rounded-[10px] bg-[#e2e6eb] bg-cover bg-center sm:w-36"
                      style={{ backgroundImage: `url("${photoPreview}")` }}
                    />
                  ) : (
                    <div className="grid h-28 w-full shrink-0 place-items-center rounded-[10px] bg-[#e8ecef] text-[#647184] sm:w-36">
                      <UploadIcon />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 text-[#28735e]">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e1f2ec]">
                        <CheckIcon />
                      </span>
                      <span className="text-xs font-semibold">Photo selected</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium text-[#31483f]">{photo.name}</p>
                    <p className="mt-1 text-xs text-[#6f8d82]">{formatFileSize(photo.size)}</p>
                    <p className="mt-1.5 text-xs text-[#6f7b89]">This photo will upload when you submit the request.</p>
                    <div className="mt-3 flex items-center gap-4">
                      <button
                        type="button"
                        onClick={openPhotoPicker}
                        className="cursor-pointer text-xs font-semibold text-[#4b62ca] hover:underline"
                      >
                        Replace photo
                      </button>
                      <button type="button" onClick={removePhoto} className="text-xs font-semibold text-[#b04d4d] hover:underline">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  className="flex min-h-28 w-full cursor-pointer flex-col items-center justify-center px-4 text-center"
                  aria-label="Choose a headlight photo"
                >
                  <span className="grid size-10 place-items-center rounded-[10px] border border-[#e1e5eb] bg-white text-[#5f6e85] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                    <UploadIcon />
                  </span>
                  <span className="mt-3 text-sm font-medium text-[#364052]">
                    {isDraggingPhoto ? "Drop your photo here" : "Choose a photo"}
                  </span>
                  <span className="mt-1 text-xs text-[#89919e]">or drag and drop · JPG, PNG, WebP, HEIC or AVIF up to 10 MB</span>
                </button>
              )}
              </div>
            </div>
            {errors.photo ? (
              <p id="photo-error" className="mt-2 text-xs font-medium text-[#c64b4b]">
                {errors.photo}
              </p>
            ) : (
              <p id="photo-help" className="mt-2 text-xs text-[#858e9d]">
                Photograph the full front headlight in good lighting and keep the damage visible.
              </p>
            )}
          </div>
        </div>

        {submitError ? (
          <div
            role="alert"
            className="mt-7 flex items-start gap-3 rounded-[10px] border border-[#efc4c4] bg-[#fff7f7] p-4 text-[#a23f3f]"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f8dddd] text-sm font-semibold">
              !
            </span>
            <div>
              <p className="text-sm font-semibold">Submission failed</p>
              <p className="mt-1 text-xs leading-5 text-[#a65b5b]">{submitError}</p>
            </div>
          </div>
        ) : null}

        {savedRequest ? (
          <div role="status" aria-live="polite" className="mt-7 flex items-start gap-3 rounded-[10px] border border-[#bcded2] bg-[#f4faf8] p-4 text-[#286c59]">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#34866f] text-white">
              <CheckIcon />
            </span>
            <div>
              <p className="text-sm font-semibold">Request and photo submitted successfully</p>
              <p className="mt-1 text-xs leading-5 text-[#577f74]">
                Reference {savedRequest.requestId.slice(0, 8).toUpperCase()} · {savedRequest.vehicle.customerName} · {savedRequest.vehicle.year} {savedRequest.vehicle.model} · {savedRequest.vehicle.side} · {savedRequest.photoName}
                {savedRequest.vehicle.vin ? ` · VIN ending in ${savedRequest.vehicle.vin.slice(-4)}` : " · No VIN provided"}.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-9 flex flex-col-reverse gap-4 border-t border-[#e8eaee] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs leading-5 text-[#858e9d]">
            <LockIcon />
            Your VIN is used only for compatibility checks.
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-[#536ee8] px-6 text-sm font-semibold text-white shadow-[0_3px_8px_rgba(83,110,232,0.22)] transition hover:bg-[#465dcc] hover:shadow-[0_5px_12px_rgba(83,110,232,0.24)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/20 active:translate-y-px disabled:cursor-wait disabled:bg-[#8e9de2] disabled:shadow-none"
          >
            {isSubmitting ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                Submitting request...
              </>
            ) : (
              <>
                Submit request and photo
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current" strokeWidth="2">
                  <path d="M4 10h11M11 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
