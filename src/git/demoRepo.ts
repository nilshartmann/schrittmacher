import type { Commit, Ref } from './types';

// Ein erfundenes Workshop-Repo als Testdaten. Jeder Commit nennt den ganzen Text der Dateien, die
// er ändert. Daraus baut `demoGit.ts` beim Start ein echtes Repo.

/**
 * Ein Commit mit den Dateien, die er ändert. Eine Datei mit `null` wird gelöscht. Der SHA ist nur
 * eine Kennung für die Branches, das echte Repo hat eigene. Das Datum steht in ISO 8601.
 */
export interface StoredCommit extends Omit<Commit, 'parents'> {
  files: Record<string, string | null>;
}

/** Commits auf einem eigenen Branch, der beim Commit `base` abzweigt. */
export interface SideBranch {
  base: string;
  commits: StoredCommit[];
}

/** Das Repo der Testdaten. */
export interface MemoryRepo {
  /** Der Name des Repos und der Branch, auf dem die Commits liegen. */
  info: { repo: string; branch: string };
  /** Die Commits vom ersten zum letzten. */
  commits: StoredCommit[];
  /** Weitere Commits, die abseits von `commits` liegen, etwa die vom Live-Coding. */
  side: SideBranch[];
  /** Die Branches mit der Kennung des Commits, auf den sie zeigen. */
  refs: Ref[];
  /** Der Branch, der im Repo selbst ausgecheckt ist; `info.branch` liegt in einem eigenen Worktree. */
  checkedOut: string;
  /** Die Dateien, die im Repo selbst geändert und nicht committet sind, wie in `StoredCommit.files`. */
  local: Record<string, string | null>;
}

const POM_1 = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>4.0.1</version>
    </parent>
    <groupId>nh.demo</groupId>
    <artifactId>bibliothek</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
    </dependencies>
</project>
`;

const POM_2 = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>4.0.1</version>
    </parent>
    <groupId>nh.demo</groupId>
    <artifactId>bibliothek</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-testcontainers</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>postgresql</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
`;

const LOAN_1 = `package nh.demo.bibliothek.loan;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;

import java.time.LocalDate;
import java.util.UUID;

@Entity
public class Loan {

    @Id
    @GeneratedValue
    private UUID id;

    private String isbn;

    private String memberId;

    private LocalDate borrowedOn;

    protected Loan() {
    }

    public Loan(String isbn, String memberId, LocalDate borrowedOn) {
        this.isbn = isbn;
        this.memberId = memberId;
        this.borrowedOn = borrowedOn;
    }

    public UUID getId() {
        return id;
    }

    public String getIsbn() {
        return isbn;
    }

    public String getMemberId() {
        return memberId;
    }

    public LocalDate getBorrowedOn() {
        return borrowedOn;
    }
}
`;

const LOAN_2 = `package nh.demo.bibliothek.loan;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;

import java.time.LocalDate;
import java.time.Period;
import java.util.UUID;

@Entity
public class Loan {

    static final Period LOAN_PERIOD = Period.ofWeeks(4);

    @Id
    @GeneratedValue
    private UUID id;

    private String isbn;

    private String memberId;

    private LocalDate borrowedOn;

    private LocalDate dueOn;

    private LocalDate returnedOn;

    protected Loan() {
    }

    public Loan(String isbn, String memberId, LocalDate borrowedOn) {
        this.isbn = isbn;
        this.memberId = memberId;
        this.borrowedOn = borrowedOn;
        this.dueOn = borrowedOn.plus(LOAN_PERIOD);
    }

    // 🕵 Zeigen: "heute" kommt von außen, die Entity kennt keine Uhr
    public boolean isOverdue(LocalDate today) {
        return returnedOn == null && today.isAfter(dueOn);
    }

    public void markReturned(LocalDate today) {
        if (returnedOn != null) {
            throw new IllegalStateException("Ausleihe " + id + " für Buch " + isbn + " wurde bereits am " + returnedOn + " zurückgegeben und kann nicht erneut zurückgegeben werden");
        }
        this.returnedOn = today;
    }

    public UUID getId() {
        return id;
    }

    public String getIsbn() {
        return isbn;
    }

    public String getMemberId() {
        return memberId;
    }

    public LocalDate getBorrowedOn() {
        return borrowedOn;
    }

    public LocalDate getDueOn() {
        return dueOn;
    }
}
`;

const MIGRATION_1 = `-- Die Tabelle zur Entity Loan
CREATE TABLE loan (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    isbn        VARCHAR(17) NOT NULL,
    member_id   VARCHAR(36) NOT NULL,
    borrowed_on DATE        NOT NULL DEFAULT current_date
);

/* TODO: Index erst anlegen, wenn die Suche nach Mitglied kommt */
CREATE INDEX loan_member_id ON loan (member_id);

INSERT INTO loan (isbn, member_id, borrowed_on)
VALUES ('978-3-16-148410-0', 'm-0001', '2026-10-01'),
       ('978-3-86490-552-0', 'm-0002', NULL);
`;

const LOAN_REPOSITORY_1 = `package nh.demo.bibliothek.loan;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface LoanRepository extends JpaRepository<Loan, UUID> {

    List<Loan> findByMemberId(String memberId);
}
`;

const LOAN_REPOSITORY_2 = `package nh.demo.bibliothek.loan;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface LoanRepository extends JpaRepository<Loan, UUID> {

    List<Loan> findByMemberId(String memberId);

    List<Loan> findByReturnedOnIsNullAndDueOnBefore(LocalDate today);
}
`;

const SERVICE_1 = `package nh.demo.bibliothek.loan;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.UUID;

@Service
public class LoanService {

    private static final Logger log = LoggerFactory.getLogger(LoanService.class);

    private final LoanRepository loanRepository;

    public LoanService(LoanRepository loanRepository) {
        this.loanRepository = loanRepository;
    }

    @Transactional
    public UUID borrowBook(String isbn, String memberId) {
        var loan = new Loan(isbn, memberId, LocalDate.now());
        loanRepository.save(loan);
        log.info("Buch {} an Mitglied {} ausgeliehen", isbn, memberId);
        return loan.getId();
    }
}
`;

const SERVICE_2 = `package nh.demo.bibliothek.loan;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.UUID;

@Service
public class LoanService {

    private static final Logger log = LoggerFactory.getLogger(LoanService.class);

    private final LoanRepository loanRepository;

    public LoanService(LoanRepository loanRepository) {
        this.loanRepository = loanRepository;
    }

    // 🕵 Erzählen: Ein Buch ist vier Wochen ausgeliehen. Wer entscheidet, wann "heute" ist?
    // 🕵 Zeigen: LocalDate.now() steht mitten in der Logik, der Test hängt am Kalender
    @Transactional
    public UUID borrowBook(String isbn, String memberId) {
        var loan = new Loan(isbn, memberId, LocalDate.now());
        loanRepository.save(loan);
        log.info("Buch {} an Mitglied {} ausgeliehen", isbn, memberId);
        return loan.getId();
    }
}
`;

const SERVICE_3 = `package nh.demo.bibliothek.loan;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;

@Service
public class LoanService {

    private static final Logger log = LoggerFactory.getLogger(LoanService.class);

    private final LoanRepository loanRepository;
    private final Clock clock;

    public LoanService(LoanRepository loanRepository, Clock clock) {
        this.loanRepository = loanRepository;
        this.clock = clock;
    }

    // 🕵 Fallstrick: Clock gibt es nicht als Bean, ohne @Bean in der Konfiguration startet der Kontext nicht
    @Transactional
    public UUID borrowBook(String isbn, String memberId) {
        var loan = new Loan(isbn, memberId, LocalDate.now(clock));
        loanRepository.save(loan);
        log.info("Buch {} an Mitglied {} ausgeliehen, fällig am {}", isbn, memberId, loan.getDueOn());
        return loan.getId();
    }

    @Transactional
    public void returnBook(UUID loanId) {
        var loan = loanRepository.findById(loanId).orElseThrow();
        loan.markReturned(LocalDate.now(clock));
    }
}
`;

const SERVICE_4 = `package nh.demo.bibliothek.loan;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;

@Service
public class LoanService {

    private static final Logger log = LoggerFactory.getLogger(LoanService.class);

    private final LoanRepository loanRepository;
    private final ApplicationEventPublisher applicationEventPublisher;
    private final Clock clock;

    public LoanService(LoanRepository loanRepository, ApplicationEventPublisher applicationEventPublisher, Clock clock) {
        this.loanRepository = loanRepository;
        this.applicationEventPublisher = applicationEventPublisher;
        this.clock = clock;
    }

    // 🕵 Fallstrick: Clock gibt es nicht als Bean, ohne @Bean in der Konfiguration startet der Kontext nicht
    @Transactional
    public UUID borrowBook(String isbn, String memberId) {
        var loan = new Loan(isbn, memberId, LocalDate.now(clock));
        loanRepository.save(loan);
        log.info("Buch {} an Mitglied {} ausgeliehen, fällig am {}", isbn, memberId, loan.getDueOn());
        return loan.getId();
    }

    // 🕵 Zeigen: Die Ausleihe weiß nichts von Reservierungen, sie meldet nur die Rückgabe
    @Transactional
    public void returnBook(UUID loanId) {
        var loan = loanRepository.findById(loanId).orElseThrow();
        var today = LocalDate.now(clock);
        loan.markReturned(today);
        applicationEventPublisher.publishEvent(new BookReturned(loan.getId(), loan.getIsbn(), loan.getMemberId(), today));
    }
}
`;

const SERVICE_5 = `package nh.demo.bibliothek.loan;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class LoanService {

    private static final Logger log = LoggerFactory.getLogger(LoanService.class);

    private final LoanRepository loanRepository;
    private final ApplicationEventPublisher applicationEventPublisher;
    private final FeeCalculator feeCalculator;
    private final Clock clock;

    public LoanService(LoanRepository loanRepository, ApplicationEventPublisher applicationEventPublisher, FeeCalculator feeCalculator, Clock clock) {
        this.loanRepository = loanRepository;
        this.applicationEventPublisher = applicationEventPublisher;
        this.feeCalculator = feeCalculator;
        this.clock = clock;
    }

    // 🕵 Fallstrick: Clock gibt es nicht als Bean, ohne @Bean in der Konfiguration startet der Kontext nicht
    @Transactional
    public UUID borrowBook(String isbn, String memberId) {
        var loan = new Loan(isbn, memberId, LocalDate.now(clock));
        loanRepository.save(loan);
        log.info("Buch {} an Mitglied {} ausgeliehen, fällig am {}", isbn, memberId, loan.getDueOn());
        return loan.getId();
    }

    // 🕵 Zeigen: Die Ausleihe weiß nichts von Reservierungen, sie meldet nur die Rückgabe
    @Transactional
    public BigDecimal returnBook(UUID loanId) {
        var loan = loanRepository.findById(loanId).orElseThrow();
        var today = LocalDate.now(clock);
        var overdueDays = Math.max(0, ChronoUnit.DAYS.between(loan.getDueOn(), today));
        var fee = feeCalculator.feeFor(overdueDays);
        loan.markReturned(today);
        log.info("Rückgabe von Buch {} durch Mitglied {} am {}, davon {} Tage überfällig, Mahngebühr {} Euro", loan.getIsbn(), loan.getMemberId(), today, overdueDays, fee);
        applicationEventPublisher.publishEvent(new BookReturned(loan.getId(), loan.getIsbn(), loan.getMemberId(), today));
        return fee;
    }
}
`;

const CONTROLLER_1 = `package nh.demo.bibliothek.loan;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/loans")
public class LoanController {

    private final LoanService loanService;

    public LoanController(LoanService loanService) {
        this.loanService = loanService;
    }

    // 🕵 Zeigen: Der Controller kennt nur Records, die Entity verlässt den Service nicht
    @PostMapping
    public ResponseEntity<LoanCreated> borrow(@RequestBody BorrowRequest request) {
        var id = loanService.borrowBook(request.isbn(), request.memberId());
        return ResponseEntity.created(URI.create("/api/loans/" + id)).body(new LoanCreated(id));
    }

    record BorrowRequest(String isbn, String memberId) {
    }

    record LoanCreated(UUID id) {
    }
}
`;

const BOOK_RETURNED = `package nh.demo.bibliothek.loan;

import java.time.LocalDate;
import java.util.UUID;

public record BookReturned(UUID loanId, String isbn, String memberId, LocalDate returnedOn) {
}
`;

const LISTENER_1 = `package nh.demo.bibliothek.reservation;

import nh.demo.bibliothek.loan.BookReturned;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class ReservationListener {

    private static final Logger log = LoggerFactory.getLogger(ReservationListener.class);

    private final ReservationRepository reservationRepository;

    public ReservationListener(ReservationRepository reservationRepository) {
        this.reservationRepository = reservationRepository;
    }

    @EventListener
    public void onBookReturned(BookReturned event) {
        reservationRepository.findFirstByIsbnOrderByReservedAtAsc(event.isbn())
            .ifPresent(reservation -> {
                reservation.notifyMember();
                log.info("Mitglied {} wird benachrichtigt: Buch {} liegt zur Abholung bereit", reservation.getMemberId(), event.isbn());
            });
    }
}
`;

const LISTENER_2 = `package nh.demo.bibliothek.reservation;

import nh.demo.bibliothek.loan.BookReturned;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

@Component
public class ReservationListener {

    private static final Logger log = LoggerFactory.getLogger(ReservationListener.class);

    private final ReservationRepository reservationRepository;

    public ReservationListener(ReservationRepository reservationRepository) {
        this.reservationRepository = reservationRepository;
    }

    // 🕵 Zeigen: im Log steht ein eigener Thread, die Rückgabe wartet nicht mehr auf die Benachrichtigung
    @Async
    @EventListener
    public void onBookReturned(BookReturned event) {
        reservationRepository.findFirstByIsbnOrderByReservedAtAsc(event.isbn())
            .ifPresent(reservation -> {
                reservation.notifyMember();
                log.info("Mitglied {} wird benachrichtigt: Buch {} liegt zur Abholung bereit", reservation.getMemberId(), event.isbn());
            });
    }
}
`;

const LISTENER_3 = `package nh.demo.bibliothek.reservation;

import nh.demo.bibliothek.loan.BookReturned;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class ReservationListener {

    private static final Logger log = LoggerFactory.getLogger(ReservationListener.class);

    private final ReservationRepository reservationRepository;

    public ReservationListener(ReservationRepository reservationRepository) {
        this.reservationRepository = reservationRepository;
    }

    // 🕵 Zeigen: im Log steht ein eigener Thread, die Rückgabe wartet nicht mehr auf die Benachrichtigung
    // 🕵 Zeigen: throw in returnBook, die Benachrichtigung bleibt jetzt aus
    // 🕵 Erzählen: Spring verlangt REQUIRES_NEW, weil die Transaktion der Rückgabe schon abgeschlossen ist
    // 🕵 Fallstrick: nur @Transactional ohne REQUIRES_NEW, dann startet die Anwendung nicht
    @Async
    @TransactionalEventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onBookReturned(BookReturned event) {
        reservationRepository.findFirstByIsbnOrderByReservedAtAsc(event.isbn())
            .ifPresent(reservation -> {
                reservation.notifyMember();
                log.info("Mitglied {} wird benachrichtigt: Buch {} liegt zur Abholung bereit", reservation.getMemberId(), event.isbn());
            });
    }
}
`;

const FEE_CALCULATOR = `package nh.demo.bibliothek.loan;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

@Component
public class FeeCalculator {

    static final BigDecimal FEE_PER_DAY = new BigDecimal("0.50");
    static final BigDecimal MAX_FEE = new BigDecimal("10.00");

    public BigDecimal feeFor(long overdueDays) {
        if (overdueDays <= 0) {
            return BigDecimal.ZERO;
        }
        // 🕵 Erzählen: Die Gebühr ist gedeckelt, damit ein vergessenes Buch nicht teurer wird als ein neues
        return FEE_PER_DAY.multiply(BigDecimal.valueOf(overdueDays)).min(MAX_FEE).setScale(2, RoundingMode.HALF_UP);
    }
}
`;

const SERVICE_TEST = `package nh.demo.bibliothek.loan;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class LoanServiceTest {

    @TestConfiguration
    static class Config {

        @Bean
        @ServiceConnection
        PostgreSQLContainer<?> postgres() {
            return new PostgreSQLContainer<>("postgres:18-alpine");
        }

        // 🕵 Zeigen: Die Uhr steht still, der Test ist an jedem Tag gleich
        @Bean
        Clock clock() {
            return Clock.fixed(Instant.parse("2026-11-02T10:00:00Z"), ZoneId.of("Europe/Berlin"));
        }
    }

    @Autowired
    LoanService loanService;

    @Autowired
    MutableClock clock;

    @Test
    void returnBook_charges_a_fee_for_each_day_after_the_due_date_but_never_more_than_the_maximum() {
        var loanId = loanService.borrowBook("978-3-86490-123-4", "M-0042");
        // 🕵 Fallstrick: Clock.fixed lässt sich nicht vorstellen, dafür braucht es eine eigene MutableClock
        clock.advanceBy(java.time.Duration.ofDays(28 + 3));
        assertThat(loanService.returnBook(loanId)).isEqualByComparingTo(new BigDecimal("1.50"));
    }
}
`;

export const DEMO_REPO: MemoryRepo = {
  info: {
    repo: '2026-11-05-spring-bibliothek-prepare',
    branch: 'schritte',
  },
  refs: [
    { name: 'main', kind: 'local', sha: '3a1f0c2' },
    { name: 'origin/main', kind: 'remote', sha: '3a1f0c2' },
    { name: 'live_coding', kind: 'local', sha: 'b3e70d1' },
    { name: 'workshop/live_coding', kind: 'remote', sha: 'b3e70d1' },
    { name: 'schritte', kind: 'local', sha: '84c7d2f' },
    { name: 'backup/vor-transaktionen', kind: 'local', sha: '51c08ad' },
    { name: 'backup/vor-listener', kind: 'local', sha: '9be4d71' },
    { name: 'origin/schritte', kind: 'remote', sha: '84c7d2f' },
  ],
  checkedOut: 'live_coding',
  // Das Live-Coding steckt mitten in Schritt 04a, und eine Notiz ist dazugekommen.
  local: {
    'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_2,
    'NOTIZEN.md': `# Notizen zum Live-Coding

- Nach 04a eine Pause machen
- Bei 06b auf die Transaktion achten
`,
  },
  // Das Live-Coding im Workshop zweigt nach dem ersten Schritt ab und baut die Schritte nach.
  side: [
    {
      base: '3a1f0c2',
      commits: [
        {
          sha: 'a2c4e91',
          step: '02',
          title: 'Der LoanService leiht ein Buch aus',
          author: 'Nils Hartmann',
          date: '2026-10-24T14:10:00+02:00',
          files: { 'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_1 },
        },
        {
          sha: 'b3e70d1',
          step: '03',
          title: 'Ein REST-Endpunkt für die Ausleihe',
          author: 'Nils Hartmann',
          date: '2026-10-24T14:35:00+02:00',
          files: { 'src/main/java/nh/demo/bibliothek/loan/LoanController.java': CONTROLLER_1 },
        },
      ],
    },
  ],
  commits: [
    {
      sha: '3a1f0c2',
      step: '01',
      title: 'Die Ausleihe als Entity, mit Repository und pom.xml',
      author: 'Nils Hartmann',
      date: '2026-10-20T09:12:00+02:00',
      files: {
        'pom.xml': POM_1,
        'src/main/java/nh/demo/bibliothek/loan/Loan.java': LOAN_1,
        'src/main/java/nh/demo/bibliothek/loan/LoanRepository.java': LOAN_REPOSITORY_1,
        'src/main/resources/db/migration/V1__loan.sql': MIGRATION_1,
      },
    },
    {
      sha: '9be4d71',
      step: '02',
      title: 'Der LoanService leiht ein Buch aus',
      author: 'Nils Hartmann',
      date: '2026-10-20T09:40:00+02:00',
      files: { 'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_1 },
    },
    {
      sha: '51c08ad',
      step: '03',
      title: 'Ein REST-Endpunkt für die Ausleihe',
      author: 'Nils Hartmann',
      date: '2026-10-20T10:05:00+02:00',
      files: { 'src/main/java/nh/demo/bibliothek/loan/LoanController.java': CONTROLLER_1 },
    },
    {
      sha: 'c7e2b90',
      step: '04a',
      title: 'Interaktion: Wann ist ein Buch überfällig?',
      author: 'Nils Hartmann',
      date: '2026-10-21T14:22:00+02:00',
      files: { 'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_2 },
    },
    {
      sha: '0d93f4e',
      step: '04b',
      title: 'Die Fälligkeit mit einer Clock statt LocalDate.now(), und die Rückgabe',
      author: 'Nils Hartmann',
      date: '2026-10-21T14:51:00+02:00',
      files: {
        'src/main/java/nh/demo/bibliothek/loan/Loan.java': LOAN_2,
        'src/main/java/nh/demo/bibliothek/loan/LoanRepository.java': LOAN_REPOSITORY_2,
        'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_3,
      },
    },
    {
      sha: 'e48a1b7',
      step: '05',
      title: 'Die Rückgabe als Event, und die Reservierung hört zu',
      author: 'Nils Hartmann',
      date: '2026-10-22T08:30:00+02:00',
      files: {
        'src/main/java/nh/demo/bibliothek/loan/BookReturned.java': BOOK_RETURNED,
        'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_4,
        'src/main/java/nh/demo/bibliothek/reservation/ReservationListener.java': LISTENER_1,
      },
    },
    {
      sha: '7f2c5e0',
      step: '06a',
      title: 'Der Listener mit @Async, er läuft in einem eigenen Thread',
      author: 'Nils Hartmann',
      date: '2026-10-22T09:02:00+02:00',
      files: {
        'src/main/java/nh/demo/bibliothek/reservation/ReservationListener.java': LISTENER_2,
      },
    },
    {
      sha: 'a6d3e81',
      step: '06b',
      title: 'Mit @TransactionalEventListener erst nach dem Commit von returnBook',
      author: 'Nils Hartmann',
      date: '2026-10-22T09:27:00+02:00',
      files: {
        'src/main/java/nh/demo/bibliothek/reservation/ReservationListener.java': LISTENER_3,
      },
    },
    {
      sha: '2b8f6c4',
      step: '07',
      title: 'Die Mahngebühr bei der Rückgabe, gedeckelt auf zehn Euro',
      author: 'Nils Hartmann',
      date: '2026-10-23T11:15:00+02:00',
      files: {
        'src/main/java/nh/demo/bibliothek/loan/FeeCalculator.java': FEE_CALCULATOR,
        'src/main/java/nh/demo/bibliothek/loan/LoanService.java': SERVICE_5,
      },
    },
    {
      sha: 'f19e0a3',
      step: null,
      title: 'Tests laufen mit Testcontainers gegen Postgres',
      author: 'Nils Hartmann',
      date: '2026-10-23T16:40:00+02:00',
      files: { 'pom.xml': POM_2 },
    },
    {
      sha: '84c7d2f',
      step: '08',
      title: 'Die Mahngebühr im Test, mit einer Uhr, die stillsteht',
      author: 'Nils Hartmann',
      date: '2026-10-24T08:55:00+02:00',
      files: { 'src/test/java/nh/demo/bibliothek/loan/LoanServiceTest.java': SERVICE_TEST },
    },
  ],
};
