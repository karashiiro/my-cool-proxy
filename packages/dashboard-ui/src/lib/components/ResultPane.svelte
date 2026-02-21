<script lang="ts">
	let {
		result,
		error,
		label,
	}: {
		result: string | undefined | null;
		error: string | undefined | null;
		label: string;
	} = $props();

	/** An individual content block from an MCP CallToolResult. */
	type ContentBlock =
		| { type: "text"; text: string }
		| { type: "image"; data: string; mimeType: string }
		| { type: "resource"; resource: unknown };

	/**
	 * Try to parse the result as a well-formed MCP content array.
	 * Returns the array of content blocks if valid, null otherwise.
	 */
	function parseContentArray(json: unknown): ContentBlock[] | null {
		// Direct content array at top-level
		if (Array.isArray(json)) {
			if (json.every(isContentBlock)) return json;
			return null;
		}

		// Object with a `content` array (CallToolResult shape)
		if (
			json !== null &&
			typeof json === "object" &&
			"content" in json &&
			Array.isArray((json as Record<string, unknown>).content)
		) {
			const arr = (json as Record<string, unknown>).content as unknown[];
			if (arr.every(isContentBlock)) return arr as ContentBlock[];
		}

		return null;
	}

	function isContentBlock(item: unknown): item is ContentBlock {
		if (item === null || typeof item !== "object") return false;
		const obj = item as Record<string, unknown>;
		if (obj.type === "text" && typeof obj.text === "string") return true;
		if (obj.type === "image" && typeof obj.data === "string" && typeof obj.mimeType === "string")
			return true;
		if (obj.type === "resource") return true;
		return false;
	}

	let parsedJson = $derived.by(() => {
		if (!result) return null;
		try {
			return JSON.parse(result);
		} catch {
			return null;
		}
	});

	let contentBlocks = $derived.by(() => {
		if (!parsedJson) return null;
		return parseContentArray(parsedJson);
	});

	let isRawText = $derived(!parsedJson && !!result);
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="section-header flex items-center gap-2 border-b border-border px-4 py-2.5">
		<svg
			class="size-3.5 text-primary/70"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path d="M4 20h16" />
			<path d="M4 4l8 8-8 8" />
		</svg>
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h2>
		{#if error}
			<span
				class="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-destructive"
			>
				<span class="inline-block size-1.5 rounded-full bg-destructive"></span>
				Error
			</span>
		{:else if result}
			<span
				class="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-success"
			>
				<span class="inline-block size-1.5 rounded-full bg-success"></span>
				OK
			</span>
		{/if}
	</div>
	{#if error}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="p-3">
				<div
					class="rounded-lg border border-destructive/20 bg-destructive/5 p-3 font-mono text-xs leading-relaxed text-red-400 whitespace-pre-wrap"
				>
					{error}
				</div>
			</div>
		</div>
	{:else if contentBlocks}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="flex flex-col gap-3 p-3">
				{#each contentBlocks as block, i (i)}
					{#if block.type === "text"}
						<pre
							class="rounded-lg border border-border bg-card/80 p-3 font-mono text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap"
						>{block.text}</pre>
					{:else if block.type === "image"}
						<div class="rounded-lg border border-border bg-card/80 p-2">
							<img
								src="data:{block.mimeType};base64,{block.data}"
								alt="Tool call result"
								class="max-h-[400px] max-w-full rounded object-contain"
							/>
						</div>
					{:else if block.type === "resource"}
						<pre
							class="rounded-lg border border-border bg-card/80 p-3 font-mono text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap"
						>{JSON.stringify(block, null, 2)}</pre>
					{/if}
				{/each}
			</div>
		</div>
	{:else if parsedJson !== null}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="p-3">
				<pre
					class="rounded-lg border border-border bg-card/80 p-3 font-mono text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap"
				>{JSON.stringify(parsedJson, null, 2)}</pre>
			</div>
		</div>
	{:else if isRawText}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="p-3">
				<pre
					class="rounded-lg border border-border bg-card/80 p-3 font-mono text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap"
				>{result}</pre>
			</div>
		</div>
	{:else}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<svg
				class="size-8 text-muted-foreground/30"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path d="M4 20h16" />
				<path d="M4 4l8 8-8 8" />
			</svg>
			<span class="text-xs text-muted-foreground">No result to display</span>
		</div>
	{/if}
</div>

<style>
	.section-header {
		background: linear-gradient(
			180deg,
			oklch(0.17 0.015 260) 0%,
			oklch(0.15 0.012 260) 100%
		);
	}
</style>
