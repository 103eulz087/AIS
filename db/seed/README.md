# Bootstrap order

Exactly two things are seeded. Everything after them is the normal process.

1. `01_reference.sql` — reference lists.
2. **The National Council body**, and a **System Admin technical account**.
   The System Admin holds no office. His approval authority is temporary.

Then:

3. **Pilot chapters register.** No city, provincial or regional council exists yet, so by the
   routing rule the National Council is the nearest existing ancestor and approves them
   directly. This is the moment the register comes into existence — every member in the
   system traces back to one of these chapter registrations.
4. **The National Council seats its own officers**, selected from the members created in
   step 3. Dropdown only. **The System Admin's organizational authority ends here**, as a
   consequence of that seating rather than an action he takes.
5. **National creates the first region**, seating its officers from members of chapters
   inside that region. Then region → province → city, each the same screen.
6. From here, new chapters route to their own city council.

Pick pilot chapters concentrated in one city, in one province, in one region. A pilot
scattered across four regions can seat no council except National.

Bootstrap is not a one-time event. The same sequence runs at the edge of the organization
every time it grows into a new city, which is why it is an ordinary path and not a script.

`02_demo_chapter.sql` is a shortcut for local development only. Never run it in production.
