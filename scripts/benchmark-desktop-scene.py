# Isolated moving scene for benchmark-desktop.mjs. Never run on a real desktop.
import tkinter as tk
root=tk.Tk(); root.geometry('1920x1080+0+0'); root.overrideredirect(True)
c=tk.Canvas(root,width=1920,height=1080,highlightthickness=0,bg='#202020'); c.pack()
bar=c.create_rectangle(0,0,200,100,fill='#0000ff',outline='')
rects=[c.create_rectangle(0,0,1,1,fill='#%06x'%((i*193477+9823)%0xffffff),outline='') for i in range(180)]
frame=0
red=False
def key(e):
 global red
 red=not red; c.itemconfig(bar,fill='#ff0000' if red else '#0000ff')
root.bind('<KeyPress>',key); root.focus_force()
def tick():
 global frame
 frame+=1
 for i,r in enumerate(rects):
  x=(i*137+frame*13)%1920; y=110+(i*83+frame*7)%970
  c.coords(r,x,y,x+150,y+80)
 c.tag_raise(bar)
 root.after(33,tick)
tick(); root.mainloop()
