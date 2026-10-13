# Pixel Art Studio

A browser-based pixel art editor built with vanilla JavaScript, HTML, CSS, and Canvas. No build step or backend is required.

## Features

- Import an image and convert it into pixel art with a generated color palette.
- Draw with pencil, eraser, flood fill, eyedropper, and canvas-move tools.
- Zoom, pan, toggle the pixel grid, and preview the original image.
- Undo and redo edits, then export the result as a PNG.

## Run

Open `index.html` in a modern browser. The editor reads the selected image in the browser and draws on Canvas; the application code does not upload images to a server. The page loads its typography from Google Fonts.

## Files

```text
index.html   Editor interface
style.css    Layout and visual styles
app.js       Image processing and editing tools
```

No license file is included, so this repository does not grant reuse or redistribution rights.

---

# Pixel Art Studio 像素艺术编辑器

使用原生 JavaScript、HTML、CSS 和 Canvas 编写的浏览器像素画编辑器，无需构建步骤或后端服务。

可以导入图片并转换为像素画，使用自动调色板、铅笔、橡皮、填充、吸管和画布移动工具；支持缩放、平移、网格显示、查看原图、撤销/重做及 PNG 导出。

直接用现代浏览器打开 `index.html`。图片通过浏览器本地读取并绘制到 Canvas，应用源码不会把图片上传到服务器；页面会从 Google Fonts 加载字体。

当前未附带许可证文件；本仓库未授予代码复用或再分发许可。
