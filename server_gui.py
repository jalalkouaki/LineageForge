import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import threading
import webbrowser
import socket
import time
import os
import sys
import shutil


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = SCRIPT_DIR
PORT_FILE = os.path.join(SCRIPT_DIR, ".server-port")


class ServerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Local Server Control")
        self.root.geometry("520x340")
        self.root.resizable(False, False)

        self.process = None
        self.port = 3000
        self._stop_event = threading.Event()

        style = ttk.Style()
        style.theme_use("clam")

        main_frame = ttk.Frame(root, padding="20")
        main_frame.pack(fill=tk.BOTH, expand=True)

        title_label = ttk.Label(main_frame, text="Local Server", font=("Segoe UI", 16, "bold"))
        title_label.pack(pady=(0, 20))

        btn_frame = ttk.Frame(main_frame)
        btn_frame.pack(pady=10)

        self.start_btn = ttk.Button(btn_frame, text="Start Server", command=self.start_server, width=15)
        self.start_btn.pack(side=tk.LEFT, padx=5)

        self.stop_btn = ttk.Button(btn_frame, text="Stop Server", command=self.stop_server, width=15, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT, padx=5)

        url_frame = ttk.Frame(main_frame)
        url_frame.pack(pady=20, fill=tk.X)

        ttk.Label(url_frame, text="Server URL:").pack(anchor=tk.W)

        self.url_var = tk.StringVar()
        self.url_label = tk.Label(
            url_frame,
            textvariable=self.url_var,
            font=("Consolas", 10),
            fg="#1a73e8",
            cursor="hand2",
            anchor="w",
        )
        self.url_label.pack(fill=tk.X, pady=(5, 0))
        self.url_label.bind("<Button-1>", self.open_url)
        self.url_label.bind("<Double-Button-1>", self.copy_url)

        hint_label = ttk.Label(url_frame, text="Click to open • Double-click to copy", font=("Segoe UI", 8))
        hint_label.pack(anchor=tk.W, pady=(2, 0))

        self.status_var = tk.StringVar(value="Ready")
        self.status_label = ttk.Label(main_frame, textvariable=self.status_var, foreground="gray")
        self.status_label.pack(pady=10)

    def find_node_command(self):
        candidates = []
        if sys.platform == "win32":
            candidates = ["node.exe", "node"]
        else:
            candidates = ["node"]

        for cmd in candidates:
            path = shutil.which(cmd)
            if path:
                return path
        return None

    def find_npx_command(self):
        if sys.platform == "win32":
            return shutil.which("npx.cmd") or shutil.which("npx")
        return shutil.which("npx")

    def find_available_port(self):
        for port in range(3000, 3010):
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.bind(("", port))
                s.close()
                if not os.path.exists(PORT_FILE):
                    with open(PORT_FILE, "w") as f:
                        f.write(str(port))
                return port
            except OSError:
                continue
        return None

    def start_server(self):
        if self.process:
            return

        node_cmd = self.find_node_command()
        if not node_cmd:
            messagebox.showerror("Error", "Node.js is not installed or not in PATH")
            return

        npx_cmd = self.find_npx_command()
        if not npx_cmd:
            messagebox.showerror("Error", "npx is not installed or not in PATH")
            return

        self.port = self.find_available_port()
        if not self.port:
            messagebox.showerror("Error", "Could not find an available port")
            return

        self.status_var.set("Starting dev server...")
        self.start_btn.config(state=tk.DISABLED)
        self.root.update()

        self._stop_event.clear()

        def run():
            try:
                env = os.environ.copy()
                env["PORT"] = str(self.port)

                self.process = subprocess.Popen(
                    [npx_cmd, "next", "dev", "-p", str(self.port)],
                    cwd=PROJECT_DIR,
                    env=env,
                    shell=(sys.platform == "win32"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )

                for _ in range(120):
                    if self._stop_event.is_set():
                        return
                    time.sleep(0.5)
                    try:
                        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        s.settimeout(0.5)
                        result = s.connect_ex(("localhost", self.port))
                        s.close()
                        if result == 0:
                            break
                    except Exception:
                        pass
                else:
                    if not self._stop_event.is_set():
                        self.root.after(0, lambda: messagebox.showerror("Error", "Dev server did not start in time"))
                        self.root.after(0, self.stop_server)
                    return

                if not self._stop_event.is_set():
                    localhost_url = f"http://localhost:{self.port}"
                    self.root.after(0, lambda: self.url_var.set(localhost_url))
                    self.root.after(0, lambda: self.status_var.set(f"Running on port {self.port}"))
                    self.root.after(0, lambda: self.status_label.config(foreground="green"))
                    self.root.after(0, lambda: self.stop_btn.config(state=tk.NORMAL))

                    if messagebox.askyesno("Server Started", f"Server started at:\n{localhost_url}\n\nOpen in browser?"):
                        webbrowser.open(localhost_url)

            except Exception as e:
                if not self._stop_event.is_set():
                    self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to start server: {e}"))
                    self.root.after(0, self.stop_server)

        threading.Thread(target=run, daemon=True).start()

    def stop_server(self):
        self._stop_event.set()
        if self.process:
            try:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
            except Exception:
                pass
            self.process = None

        if os.path.exists(PORT_FILE):
            try:
                os.remove(PORT_FILE)
            except Exception:
                pass

        self.url_var.set("")
        self.status_var.set("Stopped")
        self.status_label.config(foreground="gray")
        self.start_btn.config(state=tk.NORMAL)
        self.stop_btn.config(state=tk.DISABLED)

    def open_url(self, event):
        url = self.url_var.get()
        if url:
            webbrowser.open(url)

    def copy_url(self, event):
        url = self.url_var.get()
        if url:
            self.root.clipboard_clear()
            self.root.clipboard_append(url)
            self.status_var.set("URL copied to clipboard!")
            self.root.after(2000, lambda: self.status_var.set(f"Running on port {self.port}"))


if __name__ == "__main__":
    root = tk.Tk()
    app = ServerGUI(root)
    root.mainloop()
